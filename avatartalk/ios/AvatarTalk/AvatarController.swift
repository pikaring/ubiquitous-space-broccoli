import Foundation
import QuartzCore
import RealityKit
import UIKit

/// 3D アバターの組み立てと、毎フレームの動きを担当する。
///
/// 見た目は球と箱だけで作ってある。素材ファイルを一切持たなくても
/// ビルドすれば動くようにするため。自分で用意した .usdz があれば
/// `Avatar.usdz` という名前でバンドルに入れておくと、そちらが使われる。
@MainActor
final class AvatarController {
    enum Mode {
        case idle
        case listening
        case thinking
        case speaking
    }

    /// シーンに追加するルート。
    let root = Entity()

    var mode: Mode = .idle
    /// マイクの入力レベル（0…1）。聞いているときの反応に使う。
    var micLevel: Float = 0

    private var head = Entity()
    private var body = Entity()
    private var mouth = ModelEntity()
    private var eyeLeft = Entity()
    private var eyeRight = Entity()
    private var browLeft = Entity()
    private var browRight = Entity()
    private var customAvatar: Entity?

    private var displayLink: CADisplayLink?
    private var elapsed: Double = 0
    private var lastTick: CFTimeInterval = 0

    // 目標値と現在値。毎フレーム指数的に近づけることで、
    // どの状態からでも角が立たずに動く。
    private var targetViseme: Viseme = .closed
    private var mouthOpen: Float = 0
    private var mouthWidth: Float = 1
    private var eyeOpen: Float = 1
    private var nextBlink: Double = 2
    private var blinkUntil: Double = -1
    private var headYaw: Float = 0
    private var headPitch: Float = 0
    private var headRoll: Float = 0

    // MARK: - 組み立て

    func build(hue: Double) {
        root.children.forEach { $0.removeFromParent() }

        if let loaded = Self.loadBundledAvatar() {
            // 自前の .usdz。だいたい 1.6m 前後で作られているので、
            // バストアップに収まるよう縮めて持ち上げる。
            loaded.scale = .init(repeating: 0.42)
            loaded.position = [0, -0.36, 0]
            root.addChild(loaded)
            customAvatar = loaded
            head = loaded
            addLights()
            return
        }
        customAvatar = nil

        let skin = UIColor(hue: 0.07, saturation: 0.20, brightness: 1.0, alpha: 1)
        let skinShade = UIColor(hue: 0.05, saturation: 0.30, brightness: 0.90, alpha: 1)
        let hair = UIColor(hue: CGFloat(hue), saturation: 0.45, brightness: 0.78, alpha: 1)
        let hairLight = UIColor(hue: CGFloat(hue), saturation: 0.36, brightness: 0.92, alpha: 1)
        let outfit = UIColor(hue: CGFloat(hue), saturation: 0.30, brightness: 0.42, alpha: 1)
        let outfitTrim = UIColor(hue: CGFloat(hue), saturation: 0.20, brightness: 0.95, alpha: 1)
        let iris = UIColor(hue: CGFloat(hue.truncatingRemainder(dividingBy: 1)), saturation: 0.55, brightness: 0.55, alpha: 1)

        // ---- 体 --------------------------------------------------------
        body = Entity()
        let torso = Self.part(.generateCylinder(height: 0.34, radius: 0.125), outfit)
        torso.position = [0, 0.02, 0]
        body.addChild(torso)

        let collar = Self.part(.generateCylinder(height: 0.03, radius: 0.075), outfitTrim)
        collar.position = [0, 0.185, 0]
        body.addChild(collar)

        for side in [Float(-1), 1] {
            let shoulder = Self.part(.generateSphere(radius: 0.062), outfit)
            shoulder.position = [side * 0.115, 0.15, 0]
            body.addChild(shoulder)
        }

        let neck = Self.part(.generateCylinder(height: 0.06, radius: 0.036), skinShade)
        neck.position = [0, 0.205, 0]
        body.addChild(neck)
        root.addChild(body)

        // ---- 頭 --------------------------------------------------------
        head = Entity()
        head.position = [0, 0.235, 0]

        let skull = Self.part(.generateSphere(radius: 0.115), skin)
        skull.scale = [0.94, 1.06, 0.92]
        head.addChild(skull)

        // 後ろ髪。頭より一回り大きい球を後ろにずらして、輪郭を作る。
        let backHair = Self.part(.generateSphere(radius: 0.122), hair)
        backHair.position = [0, 0.012, -0.032]
        backHair.scale = [1.0, 1.06, 0.98]
        head.addChild(backHair)

        // 前髪。上からかぶせて額を隠す。
        let bangs = Self.part(.generateSphere(radius: 0.118), hairLight)
        bangs.position = [0, 0.055, 0.004]
        bangs.scale = [1.04, 0.62, 1.04]
        head.addChild(bangs)

        for side in [Float(-1), 1] {
            let lock = Self.part(.generateBox(size: [0.036, 0.20, 0.06], cornerRadius: 0.018), hair)
            lock.position = [side * 0.101, -0.055, 0.022]
            lock.orientation = simd_quatf(angle: side * 0.09, axis: [0, 0, 1])
            head.addChild(lock)
        }

        // ---- 顔 --------------------------------------------------------
        for (index, side) in [Float(-1), 1].enumerated() {
            let eye = Entity()
            eye.position = [side * 0.046, 0.004, 0.086]

            let white = Self.part(.generateSphere(radius: 0.025), .white)
            white.scale = [1.0, 1.18, 0.42]
            eye.addChild(white)

            let pupil = Self.part(.generateSphere(radius: 0.0155), iris)
            pupil.position = [side * 0.002, -0.001, 0.012]
            pupil.scale = [1.0, 1.15, 0.45]
            eye.addChild(pupil)

            let glint = Self.part(.generateSphere(radius: 0.0055), .white)
            glint.position = [side * 0.005, 0.008, 0.019]
            glint.scale = [1, 1, 0.5]
            eye.addChild(glint)

            head.addChild(eye)
            if index == 0 { eyeLeft = eye } else { eyeRight = eye }

            let brow = Self.part(.generateBox(size: [0.040, 0.007, 0.012], cornerRadius: 0.003), hair)
            brow.position = [side * 0.047, 0.042, 0.096]
            brow.orientation = simd_quatf(angle: side * -0.12, axis: [0, 0, 1])
            head.addChild(brow)
            if index == 0 { browLeft = brow } else { browRight = brow }

            let blush = Self.part(
                .generateSphere(radius: 0.022),
                UIColor(hue: 0.98, saturation: 0.35, brightness: 1.0, alpha: 1)
            )
            blush.position = [side * 0.072, -0.028, 0.072]
            blush.scale = [1.1, 0.62, 0.22]
            head.addChild(blush)
        }

        let nose = Self.part(.generateSphere(radius: 0.008), skinShade)
        nose.position = [0, -0.020, 0.104]
        nose.scale = [0.9, 0.7, 0.6]
        head.addChild(nose)

        mouth = Self.part(
            .generateSphere(radius: 0.018),
            UIColor(hue: 0.99, saturation: 0.55, brightness: 0.55, alpha: 1)
        )
        mouth.position = [0, -0.055, 0.092]
        mouth.scale = [1.35, 0.20, 0.45]
        head.addChild(mouth)

        root.addChild(head)
        addLights()
    }

    private func addLights() {
        // 手作りのアバターは UnlitMaterial なので照明の影響を受けないが、
        // 自前の .usdz を読み込んだときに真っ暗にならないよう置いておく。
        let key = DirectionalLight()
        key.light.intensity = 3200
        key.light.color = .white
        key.look(at: [0, 0.25, 0], from: [0.6, 1.1, 1.2], relativeTo: nil)
        root.addChild(key)

        let fill = PointLight()
        fill.light.intensity = 24000
        fill.light.attenuationRadius = 6
        fill.light.color = UIColor(white: 0.9, alpha: 1)
        fill.position = [-0.8, 0.4, 1.0]
        root.addChild(fill)
    }

    private static func part(_ mesh: MeshResource, _ color: UIColor) -> ModelEntity {
        // UnlitMaterial にしておくと、照明の設定に関係なく必ず同じ色で出る。
        // アニメ調の見た目にもよく合う。
        ModelEntity(mesh: mesh, materials: [UnlitMaterial(color: color)])
    }

    private static func loadBundledAvatar() -> Entity? {
        guard Bundle.main.url(forResource: "Avatar", withExtension: "usdz") != nil else { return nil }
        return try? Entity.load(named: "Avatar")
    }

    // MARK: - 毎フレームの更新

    func setViseme(_ viseme: Viseme) {
        targetViseme = viseme
    }

    func start() {
        guard displayLink == nil else { return }
        lastTick = CACurrentMediaTime()
        let link = CADisplayLink(target: DisplayLinkProxy { [weak self] in self?.tick() },
                                 selector: #selector(DisplayLinkProxy.fire))
        link.add(to: .main, forMode: .common)
        displayLink = link
    }

    func stop() {
        displayLink?.invalidate()
        displayLink = nil
    }

    private func tick() {
        let now = CACurrentMediaTime()
        let dt = Float(min(0.05, max(0.001, now - lastTick)))
        lastTick = now
        elapsed += Double(dt)
        let t = Float(elapsed)

        // ---- 口 --------------------------------------------------------
        let speaking = mode == .speaking
        let wantOpen = speaking ? targetViseme.openness : 0
        let wantWidth = speaking ? targetViseme.width : 1
        mouthOpen += (wantOpen - mouthOpen) * min(1, dt * 22)
        mouthWidth += (wantWidth - mouthWidth) * min(1, dt * 16)
        if !customAvatarIsActive {
            mouth.scale = [
                1.28 * mouthWidth,
                0.18 + mouthOpen * 1.55,
                0.42 + mouthOpen * 0.30,
            ]
            mouth.position.y = -0.052 - mouthOpen * 0.012
        }

        // ---- まばたき --------------------------------------------------
        if elapsed > nextBlink {
            blinkUntil = elapsed + 0.13
            nextBlink = elapsed + Double.random(in: 2.4...6.0)
        }
        let blinking = elapsed < blinkUntil
        // 考えているときは少し目を細める
        let wantEye: Float = blinking ? 0.06 : (mode == .thinking ? 0.72 : 1.0)
        eyeOpen += (wantEye - eyeOpen) * min(1, dt * 26)
        if !customAvatarIsActive {
            eyeLeft.scale = [1, eyeOpen, 1]
            eyeRight.scale = [1, eyeOpen, 1]
            let browLift: Float = mode == .listening ? 0.012 : (mode == .thinking ? -0.004 : 0)
            browLeft.position.y = 0.042 + browLift
            browRight.position.y = 0.042 + browLift
        }

        // ---- 頭と体 ----------------------------------------------------
        var wantYaw: Float = sin(t * 0.42) * 0.045
        var wantPitch: Float = sin(t * 0.31 + 1.1) * 0.028
        var wantRoll: Float = sin(t * 0.27 + 0.4) * 0.022

        switch mode {
        case .idle:
            break
        case .listening:
            // すこし前のめりに、相づちを打つように小さくうなずく
            wantPitch += 0.10 + micLevel * 0.06
            wantRoll += sin(t * 1.9) * 0.05
        case .thinking:
            // 目線を上に外して考えこむ
            wantYaw += -0.22
            wantPitch += -0.13
            wantRoll += sin(t * 0.8) * 0.03
        case .speaking:
            // 口の開き具合に合わせて自然に頭が動く
            wantPitch += mouthOpen * 0.05
            wantYaw += sin(t * 2.6) * 0.03
            wantRoll += sin(t * 1.7) * 0.025
        }

        headYaw += (wantYaw - headYaw) * min(1, dt * 6)
        headPitch += (wantPitch - headPitch) * min(1, dt * 6)
        headRoll += (wantRoll - headRoll) * min(1, dt * 6)

        let rotation =
            simd_quatf(angle: headYaw, axis: [0, 1, 0])
            * simd_quatf(angle: headPitch, axis: [1, 0, 0])
            * simd_quatf(angle: headRoll, axis: [0, 0, 1])

        if customAvatarIsActive {
            customAvatar?.orientation = simd_quatf(angle: headYaw * 0.5, axis: [0, 1, 0])
        } else {
            head.orientation = rotation
            head.position = [
                headYaw * 0.02,
                0.235 + sin(t * 0.9) * 0.004,
                0,
            ]
            // 呼吸
            let breath = 1 + sin(t * 1.05) * 0.012
            body.scale = [1, breath, 1]
        }
    }

    private var customAvatarIsActive: Bool { customAvatar != nil }
}

/// CADisplayLink は Objective-C のセレクタを要求するので、薄い橋渡しを挟む。
/// メインのランループに追加するので、常にメインスレッドから呼ばれる。
@MainActor
private final class DisplayLinkProxy: NSObject {
    private let handler: @MainActor () -> Void

    init(handler: @escaping @MainActor () -> Void) {
        self.handler = handler
    }

    @objc func fire() {
        handler()
    }
}
