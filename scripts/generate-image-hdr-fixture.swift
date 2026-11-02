// Generates our synthetic ISO gain-map JPEG regression fixture on macOS 15+.
// Usage: swift scripts/generate-image-hdr-fixture.swift <output.jpg>
import CoreImage
import Foundation

guard #available(macOS 15.0, *), CommandLine.arguments.count == 2 else {
  fatalError("Requires macOS 15+ and an output JPEG path")
}
let output = URL(fileURLWithPath: CommandLine.arguments[1])
let linear = CGColorSpace(name: CGColorSpace.extendedLinearSRGB)!
let srgb = CGColorSpace(name: CGColorSpace.sRGB)!
let pq = CGColorSpace(name: CGColorSpace.itur_2100_PQ)!
let context = CIContext(options: [.workingColorSpace: linear, .workingFormat: CIFormat.RGBAh])
let base = CIImage(color: CIColor(red: 0.8, green: 0.5, blue: 0.2, alpha: 1, colorSpace: linear)!)
  .cropped(to: CGRect(x: 0, y: 0, width: 16, height: 16))
let hdr = base.applyingFilter("CIExposureAdjust", parameters: [kCIInputEVKey: 2])
let data = context.pngRepresentation(of: hdr, format: .RGBA16, colorSpace: pq)!
let decodedHDR = CIImage(data: data, options: [.expandToHDR: true])!
try context.writeJPEGRepresentation(
  of: base, to: output, colorSpace: srgb, options: [.hdrImage: decodedHDR])
