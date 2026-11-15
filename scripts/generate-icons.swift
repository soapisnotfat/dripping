// macOS-only asset helper. Mirrors the original vector paths in public/icon.svg.
// Generated PNGs are committed, so deployment does not require Swift or AppKit.
import AppKit
for (size, name) in [(512,"icon-512.png"),(192,"icon-192.png"),(180,"apple-touch-icon.png")] {
    let context = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8,
        bytesPerRow: size * 4, space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    context.translateBy(x: 0, y: CGFloat(size)); context.scaleBy(x: CGFloat(size)/128, y: -CGFloat(size)/128)
    context.setFillColor(CGColor(red: 238/255, green: 234/255, blue: 223/255, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: 128, height: 128))
    let drop = CGMutablePath(); drop.move(to: CGPoint(x:64,y:15))
    drop.addCurve(to: CGPoint(x:27,y:78), control1: CGPoint(x:49,y:39), control2: CGPoint(x:27,y:55))
    drop.addCurve(to: CGPoint(x:64,y:115), control1: CGPoint(x:27,y:98.435), control2: CGPoint(x:43.565,y:115))
    drop.addCurve(to: CGPoint(x:101,y:78), control1: CGPoint(x:84.435,y:115), control2: CGPoint(x:101,y:98.435))
    drop.addCurve(to: CGPoint(x:64,y:15), control1: CGPoint(x:101,y:55), control2: CGPoint(x:79,y:39));drop.closeSubpath()
    context.setFillColor(CGColor(red:59/255,green:81/255,blue:71/255,alpha:1));context.addPath(drop);context.fillPath()
    let note = CGMutablePath();note.move(to:CGPoint(x:72,y:43));note.addLine(to:CGPoint(x:72,y:82))
    note.addCurve(to:CGPoint(x:50,y:87),control1:CGPoint(x:72,y:94),control2:CGPoint(x:50,y:99))
    note.addCurve(to:CGPoint(x:67,y:77),control1:CGPoint(x:50,y:79),control2:CGPoint(x:61,y:75))
    note.addLine(to:CGPoint(x:67,y:39));note.addLine(to:CGPoint(x:87,y:48));note.addLine(to:CGPoint(x:87,y:57));note.closeSubpath()
    context.setFillColor(CGColor(red:248/255,green:245/255,blue:236/255,alpha:1));context.addPath(note);context.fillPath()
    let rep = NSBitmapImageRep(cgImage:context.makeImage()!)
    try rep.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:"public/"+name))
    print("Generated \(name), \(size) × \(size)")
}
