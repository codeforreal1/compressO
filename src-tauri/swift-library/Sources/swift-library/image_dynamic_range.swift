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
  stripMetadata: Bool
) -> RustString {
  guard #available(macOS 15.0, *) else {
    return RustString("Image dynamic range processing requires macOS 15 or later")
  }
  return autoreleasepool {
    do {
      let url = URL(fileURLWithPath: inputPath.toString())
      let info = rangeInfo(url)
      let boost = mode.toString() == "boost"
      guard
        (boost && info.dynamicRange == "sdr")
          || (!boost && mode.toString() == "sdr" && info.dynamicRange == "hdr")
      else {
        return RustString("Image dynamic range operation does not match the source")
      }
      // Gain-map files can have an HDR base too: always decode the intended SDR
      // rendition explicitly for conversion, rather than just deleting the gain map.
      let options: [CIImageOption: Any] = [
        .expandToHDR: false,
        .toneMapHDRtoSDR: !boost,
        .applyOrientationProperty: true,
      ]
      guard var image = CIImage(contentsOf: url, options: options),
        let working = CGColorSpace(name: CGColorSpace.extendedLinearSRGB),
        let outputSpace = CGColorSpace(name: boost ? CGColorSpace.itur_2100_PQ : CGColorSpace.sRGB)
      else { return RustString("Could not decode image for dynamic range processing") }

      var properties = stripMetadata ? [:] : image.properties
      properties.removeValue(forKey: kCGImagePropertyOrientation as String)
      if var tiff = properties[kCGImagePropertyTIFFDictionary as String] as? [String: Any] {
        tiff.removeValue(forKey: kCGImagePropertyTIFFOrientation as String)
        properties[kCGImagePropertyTIFFDictionary as String] = tiff
      }
      if boost {
        guard intensity.isFinite && intensity >= 1 && intensity <= 4 else {
          return RustString("HDR boost intensity must be between 1 and 4")
        }
        image = image.applyingFilter(
          "CIExposureAdjust", parameters: [kCIInputEVKey: log2(intensity)])
      }
      image = image.settingProperties(properties)
      // The working image remains floating point until the color-managed export.
      // PQ encodes values above SDR white into a standard 16-bit integer PNG.
      let context = CIContext(options: [
        .workingColorSpace: working, .workingFormat: CIFormat.RGBAh,
      ])
      try context.writePNGRepresentation(
        of: image, to: URL(fileURLWithPath: outputPath.toString()), format: .RGBA16,
        colorSpace: outputSpace)
      return RustString("")
    } catch {
      return RustString("Could not process image dynamic range: \(error.localizedDescription)")
    }
  }
}
