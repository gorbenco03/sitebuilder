#!/usr/bin/env swift
import Foundation
import Vision
import AppKit

// Minimal Vision OCR for pixel oracles (raster logos innerText cannot see).
guard CommandLine.arguments.count >= 2 else {
    fputs("usage: ocr-vision.swift <image-path>\n", stderr)
    exit(2)
}
let path = CommandLine.arguments[1]
guard FileManager.default.fileExists(atPath: path),
      let img = NSImage(contentsOfFile: path),
      let tiff = img.tiffRepresentation,
      let rep = NSBitmapImageRep(data: tiff),
      let cg = rep.cgImage else {
    fputs("load-fail \(path)\n", stderr)
    exit(3)
}
let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
req.usesLanguageCorrection = false
let handler = VNImageRequestHandler(cgImage: cg, options: [:])
do {
    try handler.perform([req])
} catch {
    fputs("ocr-fail \(error)\n", stderr)
    exit(4)
}
let texts = (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }
print(texts.joined(separator: "\n"))
