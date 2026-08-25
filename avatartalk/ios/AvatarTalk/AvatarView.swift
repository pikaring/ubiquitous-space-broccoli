import RealityKit
import SwiftUI

/// アバターを表示するだけのビュー。動きは AvatarController が持つ。
struct AvatarView: View {
    let controller: AvatarController
    let hue: Double

    var body: some View {
        RealityView { content in
            // AR ではなく、ただの 3D ビューとして使う。
            content.camera = .virtual

            controller.build(hue: hue)
            content.add(controller.root)

            let camera = PerspectiveCamera()
            camera.camera.fieldOfViewInDegrees = 34
            camera.look(at: [0, 0.235, 0], from: [0, 0.26, 1.02], relativeTo: nil)
            content.add(camera)

            controller.start()
        } update: { _ in
            // 動きは CADisplayLink 側で回しているので、ここでは何もしない。
        }
        .onDisappear { controller.stop() }
    }
}
