import AppKit
import Foundation

@MainActor
private final class TrayPopoverStorage {
    static var popover: NSPopover? = nil
    static var statusButton: NSStatusBarButton? = nil
    static var delegate: TrayPopoverDelegateHandler? = nil
    static var clickMonitor: Any? = nil
    static var globalClickMonitor: Any? = nil
    static var dropDelegate: TrayIconDropDelegate? = nil
    /// A pinned popover stays open when clicking outside it (closed from the status bar icon)
    static var isPinned = false
}

/// Makes the status bar icon a drop target for files: dragging over it opens the popover (which has
/// its own drop zone), dropping on it hands the files to Rust. Files are only accepted when Rust
/// allows it (e.g. not while compressing).
@MainActor
final class TrayIconDropDelegate: NSObject, NSWindowDelegate, NSDraggingDestination {
    func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        guard tray_can_accept_files() else { return [] }
        openTrayPopover()
        return .copy
    }

    func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation {
        return tray_can_accept_files() ? .copy : []
    }

    func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        let urls =
            sender.draggingPasteboard.readObjects(
                forClasses: [NSURL.self],
                options: [.urlReadingFileURLsOnly: true]
            ) as? [URL] ?? []
        guard !urls.isEmpty,
            let data = try? JSONSerialization.data(withJSONObject: urls.map { $0.path }),
            let pathsJson = String(data: data, encoding: .utf8)
        else { return false }
        return tray_files_dropped(pathsJson)
    }
}

private struct TraySendablePointers: @unchecked Sendable {
    let window: UnsafeMutableRawPointer
    let button: UnsafeMutableRawPointer
}

class TrayPopoverDelegateHandler: NSObject, NSPopoverDelegate {
    func popoverDidShow(_ notification: Notification) {
        tray_popover_event(.Opened)

        MainActor.assumeIsolated {
            if !TrayPopoverStorage.isPinned {
                TrayPopoverDelegateHandler.setupOutsideClickMonitors()
            }
        }
    }

    func popoverDidClose(_ notification: Notification) {
        tray_popover_event(.Closed)

        MainActor.assumeIsolated {
            TrayPopoverDelegateHandler.removeOutsideClickMonitors()
        }
    }

    func popoverShouldClose(_ popover: NSPopover) -> Bool {
        if let controller = popover.contentViewController {
            controller.view.isHidden = false
            controller.view.alphaValue = 1.0
        }
        return true
    }

    @MainActor
    static func setupOutsideClickMonitors() {
        removeOutsideClickMonitors()

        guard let popover = TrayPopoverStorage.popover,
            let popoverWindow = popover.contentViewController?.view.window
        else { return }

        TrayPopoverStorage.clickMonitor = NSEvent.addLocalMonitorForEvents(matching: [
            .leftMouseDown, .rightMouseDown,
        ]) { event in
            let mouseLocation = NSEvent.mouseLocation
            if !NSMouseInRect(mouseLocation, popoverWindow.frame, false) {
                DispatchQueue.main.async {
                    closeTrayPopover()
                }
            }
            return event
        }

        TrayPopoverStorage.globalClickMonitor = NSEvent.addGlobalMonitorForEvents(matching: [
            .leftMouseDown, .rightMouseDown,
        ]) { _ in
            DispatchQueue.main.async {
                closeTrayPopover()
            }
        }
    }

    @MainActor
    static func removeOutsideClickMonitors() {
        if let monitor = TrayPopoverStorage.clickMonitor {
            NSEvent.removeMonitor(monitor)
            TrayPopoverStorage.clickMonitor = nil
        }
        if let globalMonitor = TrayPopoverStorage.globalClickMonitor {
            NSEvent.removeMonitor(globalMonitor)
            TrayPopoverStorage.globalClickMonitor = nil
        }
    }
}

public func initTrayPopoverManager(
    nsWindowPtr: UnsafeMutableRawPointer,
    nsStatusBarButtonPtr: UnsafeMutableRawPointer
) {
    let containers = TraySendablePointers(window: nsWindowPtr, button: nsStatusBarButtonPtr)

    DispatchQueue.main.async {
        let window = Unmanaged<NSWindow>.fromOpaque(containers.window).takeUnretainedValue()
        // Rust hands over an owned (+1) reference, which is consumed here
        let button = Unmanaged<NSStatusBarButton>.fromOpaque(containers.button)
            .takeRetainedValue()

        window.styleMask = []
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden

        guard let stolenView = window.contentView else { return }

        stolenView.wantsLayer = true
        stolenView.layer?.backgroundColor = NSColor.clear.cgColor

        let placeholderView = NSView(frame: .zero)
        window.contentView = placeholderView
        window.orderOut(nil)

        let targetSize = window.frame.size

        let hostingContainerView = NSView(frame: NSRect(origin: .zero, size: targetSize))
        hostingContainerView.wantsLayer = true
        hostingContainerView.layer?.backgroundColor = NSColor.clear.cgColor
        hostingContainerView.autoresizingMask = [.width, .height]

        let containerView = NSView(frame: NSRect(origin: .zero, size: targetSize))
        containerView.wantsLayer = true
        containerView.layer?.backgroundColor = NSColor.clear.cgColor
        containerView.autoresizingMask = [.width, .height]

        stolenView.frame = NSRect(origin: .zero, size: targetSize)
        stolenView.autoresizingMask = [.width, .height]
        stolenView.subviews.forEach { subview in
            subview.translatesAutoresizingMaskIntoConstraints = true
            subview.autoresizingMask = [.width, .height]
            subview.frame = NSRect(origin: .zero, size: targetSize)
        }

        containerView.addSubview(stolenView)
        hostingContainerView.addSubview(containerView)

        let viewController = NSViewController()
        viewController.view = hostingContainerView

        let popover = NSPopover()
        popover.behavior = TrayPopoverStorage.isPinned ? .applicationDefined : .transient
        popover.contentViewController = viewController
        popover.contentSize = targetSize
        popover.animates = true
        if #available(macOS 14.0, *) {
            popover.hasFullSizeContent = true
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            if let popoverWindow = popover.contentViewController?.view.window {
                popoverWindow.backgroundColor = .clear
                popoverWindow.isOpaque = false
                popoverWindow.level = .statusBar
            }
        }

        let delegate = TrayPopoverDelegateHandler()
        popover.delegate = delegate

        TrayPopoverStorage.popover = popover
        TrayPopoverStorage.statusButton = button
        TrayPopoverStorage.delegate = delegate

        // The status bar window forwards drag & drop to its delegate
        if let statusWindow = button.window {
            let dropDelegate = TrayIconDropDelegate()
            statusWindow.registerForDraggedTypes([.fileURL])
            statusWindow.delegate = dropDelegate
            TrayPopoverStorage.dropDelegate = dropDelegate
        }
    }
}

public func openTrayPopover() {
    DispatchQueue.main.async {
        guard let popover = TrayPopoverStorage.popover,
            let button = TrayPopoverStorage.statusButton
        else { return }

        if !popover.isShown {
            popover.show(relativeTo: button.bounds, of: button, preferredEdge: .maxY)
        }
    }
}

public func closeTrayPopover() {
    DispatchQueue.main.async {
        guard let popover = TrayPopoverStorage.popover else { return }
        if popover.isShown {
            popover.performClose(nil)
        }
    }
}

/// Releases the popover & the tray window's view it hosts (e.g. when the tray icon is removed), so
/// the destroyed webview is not kept alive
public func destroyTrayPopover() {
    DispatchQueue.main.async {
        TrayPopoverDelegateHandler.removeOutsideClickMonitors()
        if let popover = TrayPopoverStorage.popover {
            popover.delegate = nil
            if popover.isShown {
                popover.close()
            }
            popover.contentViewController = nil
        }
        if let statusWindow = TrayPopoverStorage.statusButton?.window {
            statusWindow.unregisterDraggedTypes()
            if statusWindow.delegate === TrayPopoverStorage.dropDelegate {
                statusWindow.delegate = nil
            }
        }
        TrayPopoverStorage.popover = nil
        TrayPopoverStorage.statusButton = nil
        TrayPopoverStorage.delegate = nil
        TrayPopoverStorage.dropDelegate = nil
        TrayPopoverStorage.isPinned = false
    }
}

/// Pins the popover (it stays open when clicking outside it) or restores the default behavior
public func setTrayPopoverPinned(pinned: Bool) {
    DispatchQueue.main.async {
        TrayPopoverStorage.isPinned = pinned
        guard let popover = TrayPopoverStorage.popover else { return }
        popover.behavior = pinned ? .applicationDefined : .transient
        if pinned {
            TrayPopoverDelegateHandler.removeOutsideClickMonitors()
        } else if popover.isShown {
            TrayPopoverDelegateHandler.setupOutsideClickMonitors()
        }
    }
}

public func isTrayPopoverVisible() -> Bool {
    if Thread.isMainThread {
        return MainActor.assumeIsolated { TrayPopoverStorage.popover?.isShown ?? false }
    } else {
        return DispatchQueue.main.sync {
            return MainActor.assumeIsolated { TrayPopoverStorage.popover?.isShown ?? false }
        }
    }
}

@MainActor
private func resizeSubviewsRecursively(_ view: NSView, to size: NSSize) {
    view.translatesAutoresizingMaskIntoConstraints = true

    CATransaction.begin()
    CATransaction.setDisableActions(true)
    view.frame = NSRect(origin: .zero, size: size)
    CATransaction.commit()

    for subview in view.subviews {
        resizeSubviewsRecursively(subview, to: size)
    }
}

public func resizeTrayPopover(
    width: Double, height: Double, animate: Bool = false, blurOverlayOnResize: Bool = false
) {
    Task { @MainActor in
        guard let popover = TrayPopoverStorage.popover,
            let viewController = popover.contentViewController
        else { return }

        let newSize = NSSize(width: CGFloat(width), height: CGFloat(height))
        if abs(popover.contentSize.width - newSize.width) < 0.1
            && abs(popover.contentSize.height - newSize.height) < 0.1
        {
            return
        }

        let contentView = viewController.view
        let targetRect = NSRect(origin: .zero, size: newSize)

        guard let containerView = contentView.subviews.first,
            let stolenView = containerView.subviews.first
        else { return }

        contentView.translatesAutoresizingMaskIntoConstraints = true
        containerView.translatesAutoresizingMaskIntoConstraints = true
        stolenView.translatesAutoresizingMaskIntoConstraints = true

        var temporaryBlur: NSVisualEffectView? = nil
        if blurOverlayOnResize {
            let blur = NSVisualEffectView(frame: containerView.bounds)
            blur.autoresizingMask = [.width, .height]
            blur.material = .sidebar
            blur.blendingMode = .behindWindow
            blur.state = .active
            blur.alphaValue = 1.0
            blur.wantsLayer = true
            blur.layer?.cornerRadius = 20.0
            blur.layer?.masksToBounds = true

            containerView.addSubview(blur, positioned: .above, relativeTo: nil)
            temporaryBlur = blur
        }

        let stableBlurReference = temporaryBlur

        containerView.wantsLayer = true
        containerView.layer?.shouldRasterize = true
        containerView.layer?.rasterizationScale = NSScreen.main?.backingScaleFactor ?? 2.0

        NSAnimationContext.beginGrouping()
        NSAnimationContext.current.duration = 0
        resizeSubviewsRecursively(stolenView, to: newSize)
        NSAnimationContext.endGrouping()

        popover.animates = false
        let duration = animate ? 0.45 : 0.0

        NSAnimationContext.runAnimationGroup { context in
            context.duration = duration

            if animate {
                context.timingFunction = CAMediaTimingFunction(controlPoints: 0.25, 1.0, 0.4, 1.15)
            } else {
                context.timingFunction = CAMediaTimingFunction(name: .linear)
            }

            if let popoverWindow = contentView.window {
                let currentFrame = popoverWindow.frame
                let deltaWidth = newSize.width - currentFrame.width
                let deltaHeight = newSize.height - currentFrame.height
                let newWindowFrame = NSRect(
                    x: currentFrame.origin.x - (deltaWidth / 2.0),
                    y: currentFrame.origin.y - deltaHeight,
                    width: newSize.width,
                    height: newSize.height
                )

                if animate {
                    popoverWindow.animator().setFrame(newWindowFrame, display: true)
                } else {
                    popoverWindow.setFrame(newWindowFrame, display: true)
                }
            }

            if animate {
                contentView.animator().frame = targetRect
                containerView.animator().frame = targetRect
                stolenView.animator().frame = targetRect
            } else {
                contentView.frame = targetRect
                containerView.frame = targetRect
                stolenView.frame = targetRect
            }

        } completionHandler: {
            Task { @MainActor [stableBlurReference] in
                popover.animates = false
                popover.contentSize = newSize
                contentView.frame = targetRect
                containerView.frame = targetRect
                containerView.layer?.shouldRasterize = false

                NSAnimationContext.beginGrouping()
                NSAnimationContext.current.duration = 0
                resizeSubviewsRecursively(stolenView, to: newSize)
                contentView.needsDisplay = true
                stolenView.needsDisplay = true
                NSAnimationContext.endGrouping()

                if let blur = stableBlurReference {
                    try? await Task.sleep(nanoseconds: 50_000_000)

                    NSAnimationContext.runAnimationGroup { context in
                        context.duration = 0.15
                        blur.animator().alphaValue = 0.0
                    } completionHandler: {
                        Task { @MainActor [blur] in
                            blur.removeFromSuperview()
                        }
                    }
                }
            }
        }
    }
}
