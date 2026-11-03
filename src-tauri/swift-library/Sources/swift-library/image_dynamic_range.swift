import CoreImage
import CoreImage.CIFilterBuiltins
import Foundation
import ImageIO

// Processing is deliberately independent of the current display's brightness/headroom.
// macOS 15 provides both ISO gain-map inspection and content-headroom information.
private struct ImageRangeInfo: Codable {
  var supported = false
  var dynamicRange = "unknown"
  var hasGainMap = false
}

@available(macOS 15.0, *)
private func rangeInfo(_ url: URL) -> ImageRangeInfo {
  guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
    CGImageSourceGetCount(source) == 1,
    let image = CIImage(contentsOf: url, options: [.expandToHDR: true])
  else { return ImageRangeInfo(supported: true) }

  let index = CGImageSourceGetPrimaryImageIndex(source)
  let gainMap =
    CGImageSourceCopyAuxiliaryDataInfoAtIndex(source, index, kCGImageAuxiliaryDataTypeHDRGainMap)
    != nil
    || CGImageSourceCopyAuxiliaryDataInfoAtIndex(source, index, kCGImageAuxiliaryDataTypeISOGainMap)
      != nil
  let hdrSpace = image.colorSpace.map { CGColorSpaceUsesITUR_2100TF($0) } ?? false
  let hdr = gainMap || hdrSpace || image.contentHeadroom > 1
  // A missing/extended color space with unknown headroom is not proof of SDR.
  let sdr =
    image.contentHeadroom == 1
    || (image.colorSpace.map {
      !CGColorSpaceUsesExtendedRange($0) && !CGColorSpaceUsesITUR_2100TF($0)
    } ?? false)
  return ImageRangeInfo(
    supported: true, dynamicRange: hdr ? "hdr" : (sdr ? "sdr" : "unknown"), hasGainMap: gainMap)
}

func imageDynamicRangeInfo(path: RustString) -> RustString {
  let info: ImageRangeInfo
  if #available(macOS 15.0, *) {
    info = autoreleasepool { rangeInfo(URL(fileURLWithPath: path.toString())) }
  } else {
    info = ImageRangeInfo()
  }
  let data = try! JSONEncoder().encode(info)
  return RustString(String(decoding: data, as: UTF8.self))
}

func processImageDynamicRange(
  inputPath: RustString, outputPath: RustString, mode: RustString, intensity: Float,
  stripMetadata: Bool, sdrOutputPath: RustString
) -> RustString {
  guard #available(macOS 15.0, *) else {
    return RustString("Image dynamic range processing requires macOS 15 or later")
  }
  return autoreleasepool {
    do {
      let url = URL(fileURLWithPath: inputPath.toString())
      let info = rangeInfo(url)
      let boost = mode.toString() == "boost"
      let preserve = mode.toString() == "original"
      guard
        (boost && info.dynamicRange == "sdr")
          || (!boost && ["sdr", "original"].contains(mode.toString()) && info.dynamicRange == "hdr")
      else {
        return RustString("Image dynamic range operation does not match the source")
      }
      // Gain-map files can have an HDR base too: always decode the intended SDR
      // rendition explicitly for conversion, rather than just deleting the gain map.
      let options: [CIImageOption: Any] = [
        .expandToHDR: preserve,
        .toneMapHDRtoSDR: !boost && !preserve,
        .applyOrientationProperty: true,
      ]
      guard var image = CIImage(contentsOf: url, options: options),
        let working = CGColorSpace(name: CGColorSpace.extendedLinearSRGB),
        let outputSpace = CGColorSpace(
          name: (boost || preserve) ? CGColorSpace.itur_2100_PQ : CGColorSpace.sRGB)
      else { return RustString("Could not decode image for dynamic range processing") }

      var properties = stripMetadata ? [:] : image.properties
      properties.removeValue(forKey: kCGImagePropertyOrientation as String)
      if var tiff = properties[kCGImagePropertyTIFFDictionary as String] as? [String: Any] {
        tiff.removeValue(forKey: kCGImagePropertyTIFFOrientation as String)
        properties[kCGImagePropertyTIFFDictionary as String] = tiff
      }
      let context = CIContext(options: [
        .workingColorSpace: working, .workingFormat: CIFormat.RGBAh,
      ])
      if !sdrOutputPath.toString().isEmpty {
        guard
          let base = CIImage(
            contentsOf: url,
            options: [
              .expandToHDR: false, .toneMapHDRtoSDR: true, .applyOrientationProperty: true,
            ]), let srgb = CGColorSpace(name: CGColorSpace.sRGB)
        else {
          return RustString("Could not decode the SDR base for HDR JPEG")
        }
        try context.writePNGRepresentation(
          of: base.settingProperties(properties),
          to: URL(fileURLWithPath: sdrOutputPath.toString()), format: .RGBA16, colorSpace: srgb)
      }
      if boost {
        guard intensity.isFinite && intensity >= 1 && intensity <= 8 else {
          return RustString("HDR Boost intensity must be between 1 and 8")
        }
        image = image.applyingFilter(
          "CIExposureAdjust", parameters: [kCIInputEVKey: log2(intensity)])
      }
      image = image.settingProperties(properties)
      // The working image remains floating point until the color-managed export.
      // PQ encodes values above SDR white into a standard 16-bit integer PNG.
      try context.writePNGRepresentation(
        of: image, to: URL(fileURLWithPath: outputPath.toString()), format: .RGBA16,
        colorSpace: outputSpace)
      return RustString("")
    } catch {
      return RustString("Could not process image dynamic range: \(error.localizedDescription)")
    }
  }
}

// This is the final encode. Running jpegoptim or copying arbitrary JPEG metadata
// afterwards could break the gain-map references or discard the auxiliary image.
func encodeHdrJpeg(
  basePath: RustString, hdrPath: RustString, outputPath: RustString,
  quality: UInt8, stripMetadata: Bool
) -> RustString {
  guard #available(macOS 15.0, *) else {
    return RustString("HDR JPEG export requires macOS 15 or later")
  }
  return autoreleasepool {
    do {
      guard
        let base = CIImage(
          contentsOf: URL(fileURLWithPath: basePath.toString()),
          options: [.expandToHDR: false]),
        let hdr = CIImage(
          contentsOf: URL(fileURLWithPath: hdrPath.toString()),
          options: [.expandToHDR: true]), base.extent == hdr.extent,
        let linear = CGColorSpace(name: CGColorSpace.extendedLinearSRGB),
        let srgb = CGColorSpace(name: CGColorSpace.sRGB)
      else {
        return RustString("Could not decode matching SDR and HDR images for JPEG export")
      }
      // JPEG has no alpha. Composite both renditions against the same black background.
      let background = CIImage(color: .black).cropped(to: base.extent)
      let baseImage = base.composited(over: background)
        .settingProperties(stripMetadata ? [:] : base.properties)
      let context = CIContext(options: [.workingColorSpace: linear, .workingFormat: CIFormat.RGBAh])
      // Compositing loses CIImage's headroom. Restore it on a floating-point render;
      // even a dark SDR image needs a gain map to retain its boosted rendition.
      guard
        let rendered = context.createCGImage(
          hdr.composited(over: background),
          from: hdr.extent, format: .RGBAh, colorSpace: linear)
      else {
        return RustString("Could not render HDR JPEG pixels")
      }
      let hdrImage = CIImage(
        cgImage: rendered, options: [.contentHeadroom: max(2, hdr.contentHeadroom)])
      let qualityKey = CIImageRepresentationOption(
        rawValue: kCGImageDestinationLossyCompressionQuality as String)
      let output = URL(fileURLWithPath: outputPath.toString())
      try context.writeJPEGRepresentation(
        of: baseImage, to: output, colorSpace: srgb,
        options: [.hdrImage: hdrImage, qualityKey: Double(max(1, quality)) / 100.0])
      guard rangeInfo(output).hasGainMap else {
        return RustString("HDR JPEG export did not contain a gain map")
      }
      return RustString("")
    } catch {
      return RustString("Could not encode HDR JPEG: \(error.localizedDescription)")
    }
  }
}
