import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  FogExp2,
  Group,
  IcosahedronGeometry,
  DynamicDrawUsage,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  WebGLRenderer,
} from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { config, hitboxRadius } from '../game/config'
import type { Fight } from '../game/fight'
import { nextQuality, particleCap, type Quality } from '../game/quality'
import type { StepResult } from '../game/types'

interface Spark {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  life: number
  max: number
  r: number
  g: number
  b: number
}

const dummy = new Object3D()
const hot = new Color()

export class GameView {
  readonly renderer: WebGLRenderer
  quality: Quality = 'high'
  readonly frameMs: number[] = []
  private readonly scene = new Scene()
  private readonly camera: PerspectiveCamera
  private readonly composer: EffectComposer
  private readonly bloom: UnrealBloomPass
  private readonly boss = new Group()
  private readonly coreMat: MeshBasicMaterial
  private readonly eyeMat: MeshBasicMaterial
  private readonly podMat: MeshBasicMaterial
  private readonly ship = new Group()
  private readonly hitboxDot: Mesh
  private readonly bullets: InstancedMesh
  private readonly missiles: InstancedMesh
  private readonly laser: Mesh
  private readonly laserMat: MeshBasicMaterial
  private readonly hullMat = new MeshBasicMaterial({ color: 0x7dfff4 })
  private readonly wingMat = new MeshBasicMaterial({ color: 0xff2bd6 })
  private readonly bulletMat = new MeshBasicMaterial({ color: 0xfff1a8 })
  private readonly missileMat = new MeshBasicMaterial({ color: 0xff5a3a })
  private readonly sparks: Spark[] = []
  private readonly sparkGeo: BufferGeometry
  private readonly sparkPos: Float32Array
  private readonly sparkCol: Float32Array
  private recentFrames: number[] = []
  private clock = 0
  private muzzle = 0
  private boom = false
  private width = 1
  private height = 1

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.08
    this.scene.background = new Color(0x07010f)
    this.scene.fog = new FogExp2(0x07010f, 0.055)
    this.camera = new PerspectiveCamera(config.render.fov, 9 / 19.5, 0.1, 40)
    this.camera.position.set(0, -0.45, 8.2)
    this.camera.lookAt(0, 2.4, -0.6)

    this.buildCity()
    this.coreMat = new MeshBasicMaterial({ color: 0xff2f9a })
    this.eyeMat = new MeshBasicMaterial({ color: 0x2a1030 })
    this.podMat = new MeshBasicMaterial({ color: 0x241028 })
    this.buildBoss()
    this.buildShip()
    const dotMat = new MeshBasicMaterial({
      color: 0xffffff,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
    dotMat.color.setRGB(1.5, 2.4, 2.6)
    this.hitboxDot = new Mesh(new SphereGeometry(1, 12, 8), dotMat)
    this.scene.add(this.boss)
    this.scene.add(this.ship)
    this.scene.add(this.hitboxDot)

    this.bullets = new InstancedMesh(new SphereGeometry(1, 8, 6), this.bulletMat, 48)
    this.missiles = new InstancedMesh(new ConeGeometry(1, 2.4, 6), this.missileMat, 8)
    this.bullets.instanceMatrix.setUsage(DynamicDrawUsage)
    this.missiles.instanceMatrix.setUsage(DynamicDrawUsage)
    this.bullets.frustumCulled = false
    this.missiles.frustumCulled = false
    this.scene.add(this.bullets)
    this.scene.add(this.missiles)

    this.laserMat = new MeshBasicMaterial({
      color: 0xff3df2,
      transparent: true,
      opacity: 0.9,
      blending: AdditiveBlending,
      depthWrite: false,
    })
    this.laser = new Mesh(new BoxGeometry(1, 1, 1), this.laserMat)
    this.laser.visible = false
    this.scene.add(this.laser)

    this.sparkPos = new Float32Array(config.render.maxParticlesHigh * 3)
    this.sparkCol = new Float32Array(config.render.maxParticlesHigh * 3)
    this.sparkGeo = new BufferGeometry()
    this.sparkGeo.setAttribute('position', new BufferAttribute(this.sparkPos, 3))
    this.sparkGeo.setAttribute('color', new BufferAttribute(this.sparkCol, 3))
    const points = new Points(
      this.sparkGeo,
      new PointsMaterial({
        size: 0.09,
        vertexColors: true,
        blending: AdditiveBlending,
        depthWrite: false,
        transparent: true,
      }),
    )
    points.frustumCulled = false
    this.scene.add(points)

    const renderPass = new RenderPass(this.scene, this.camera)
    this.bloom = new UnrealBloomPass(
      new Vector2(2, 2),
      config.render.bloomStrength,
      config.render.bloomRadius,
      config.render.bloomThreshold,
    )
    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(renderPass)
    this.composer.addPass(this.bloom)
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    const dpr = Math.min(window.devicePixelRatio || 1, config.render.maxDpr)
    this.renderer.setPixelRatio(dpr)
    this.renderer.setSize(this.width, this.height, false)
    this.camera.aspect = this.width / this.height
    this.camera.updateProjectionMatrix()
    this.composer.setPixelRatio(dpr)
    this.composer.setSize(this.width, this.height)
    // UnrealBloomPass.setSize renders at half the size it is given.
    const bloomW = this.width * dpr * config.render.bloomResolutionScale * 2
    const bloomH = this.height * dpr * config.render.bloomResolutionScale * 2
    this.bloom.setSize(Math.max(1, Math.floor(bloomW)), Math.max(1, Math.floor(bloomH)))
  }

  render(fight: Fight, result: StepResult, dt: number, frameMs: number): void {
    this.clock += dt
    this.noteFrame(frameMs)
    this.placeActors(fight, dt)
    this.placeHazards(fight)
    this.fx(fight, result, dt)
    this.shake(fight)
    if (this.quality === 'off') this.renderer.render(this.scene, this.camera)
    else this.composer.render()
  }

  private noteFrame(frameMs: number): void {
    this.frameMs.push(frameMs)
    if (this.frameMs.length > 120) this.frameMs.shift()
    const next = nextQuality({ quality: this.quality, recent: this.recentFrames }, frameMs)
    this.quality = next.quality
    this.recentFrames = next.recent
    this.bloom.strength =
      this.quality === 'low' ? config.render.bloomStrengthLow : config.render.bloomStrength
  }

  private placeActors(fight: Fight, dt: number): void {
    const bossAt = this.map(fight.w * 0.5, fight.h * config.boss.spawnYFraction, fight)
    this.boss.position.set(bossAt.x, bossAt.y + Math.sin(this.clock * 1.4) * 0.06, 0.85)
    this.boss.rotation.y = Math.sin(this.clock * 0.6) * 0.18
    const kinds = fight.telegraph?.kinds ?? []
    const pulse = 0.55 + Math.sin(this.clock * (fight.telegraph ? 28 : 3)) * 0.45
    hot.setRGB(1.4 * pulse, 0.15, 0.7 * pulse)
    if (kinds.includes('straight')) hot.setRGB(1.8, 1.5, 0.4)
    this.coreMat.color.copy(hot)
    this.eyeMat.color.set(kinds.includes('laser') ? 0xff7bff : 0x2a1030)
    this.podMat.color.set(kinds.includes('missile') ? 0xff5a2a : 0x241028)

    const shipAt = this.map(fight.player.x, fight.player.y, fight)
    this.ship.position.set(shipAt.x, shipAt.y, 1.15)
    this.ship.rotation.z = 0
    const boosted = fight.boostT > 0
    const gold = fight.slowT > 0
    this.hullMat.color.setHex(gold ? 0xffd24a : 0x7dfff4)
    this.wingMat.color.setHex(gold ? 0xffe9a0 : 0xff2bd6)
    this.ship.scale.setScalar(gold ? 1.28 : boosted ? 1.18 : 1)
    if (fight.mode === 'play' && fight.player.hitInvuln > 0) {
      this.ship.visible = Math.sin(this.clock * 40) > 0
    } else {
      this.ship.visible = fight.mode !== 'dead'
    }
    const dotRadius =
      (hitboxRadius(fight.w) / fight.w) *
      config.render.worldSpanX *
      config.render.hitboxDotFraction
    this.hitboxDot.position.set(shipAt.x, shipAt.y, 1.5)
    this.hitboxDot.scale.setScalar(Math.max(0.02, dotRadius))
    this.hitboxDot.visible = fight.mode !== 'dead'

    if (fight.mode === 'play') {
      this.muzzle -= dt
      if (this.muzzle <= 0) {
        this.muzzle = config.render.muzzleSec
        const count = boosted ? 3 : 1
        for (let i = 0; i < count; i++) {
          this.burst(shipAt.x, shipAt.y, 1.2, 0.4, 1, 0.9, 4, 1.6)
        }
      }
    }
  }

  private placeHazards(fight: Fight): void {
    let bullet = 0
    let missile = 0
    let laserOn = false
    let bulletWhite = false
    let missileWhite = false
    const gold = fight.slowT > 0
    for (const hazard of fight.attacks) {
      if (hazard.type === 'laser') {
        laserOn = true
        const at = this.map(hazard.x, hazard.y, fight)
        const thickness = (hazard.width / fight.w) * config.render.worldSpanX
        const tall = (hazard.height / fight.h) * config.render.worldSpanY
        this.laser.position.set(at.x, at.y, 0.7)
        this.laser.scale.set(Math.max(0.04, thickness), Math.max(0.08, tall), 0.08)
        const white = (hazard.whiteT ?? 0) > 0
        this.laserMat.opacity = white ? 1 : 0.92
        this.laserMat.color.setHex(white ? 0xffffff : 0xff4df5)
        continue
      }
      if ((hazard.whiteT ?? 0) > 0) {
        if (hazard.kind === 'missile') missileWhite = true
        else bulletWhite = true
      }
      const at = this.map(hazard.x, hazard.y, fight)
      if (hazard.kind === 'missile' && missile < this.missiles.count) {
        const ahead = this.map(hazard.x + hazard.vx, hazard.y + hazard.vy, fight)
        dummy.position.set(at.x, at.y, 0.9)
        dummy.rotation.set(0, 0, Math.atan2(-(ahead.x - at.x), ahead.y - at.y))
        dummy.scale.setScalar(0.12)
        dummy.updateMatrix()
        this.missiles.setMatrixAt(missile, dummy.matrix)
        missile += 1
      } else if (hazard.kind === 'straight' && bullet < this.bullets.count) {
        const radius = (hazard.r / fight.w) * config.render.worldSpanX
        dummy.position.set(at.x, at.y, 0.8)
        dummy.rotation.set(0, 0, 0)
        dummy.scale.setScalar(Math.max(0.05, radius))
        dummy.updateMatrix()
        this.bullets.setMatrixAt(bullet, dummy.matrix)
        bullet += 1
      }
    }
    if (!laserOn && fight.telegraph?.kinds.includes('laser') && fight.telegraph.tutorial !== 'band') {
      laserOn = true
      const fromLeft = fight.laserFromLeft
      const edge = fromLeft ? fight.w * 0.06 : fight.w * 0.94
      const at = this.map(edge, fight.h * config.boss.laserCenterFraction, fight)
      const tall = config.boss.laserHeightFraction * config.render.worldSpanY
      this.laser.position.set(at.x, at.y, 0.7)
      this.laser.scale.set(0.06, Math.max(0.08, tall), 0.04)
      this.laserMat.opacity = 0.35 + Math.sin(this.clock * 24) * 0.2
      this.laserMat.color.setHex(0xff9af8)
    }
    this.laser.visible = laserOn
    this.bulletMat.color.setHex(bulletWhite ? 0xffffff : gold ? 0xffd24a : 0xfff1a8)
    this.missileMat.color.setHex(missileWhite ? 0xffffff : gold ? 0xffd24a : 0xff5a3a)
    this.hideRest(this.bullets, bullet)
    this.hideRest(this.missiles, missile)
  }

  private hideRest(mesh: InstancedMesh, used: number): void {
    for (let i = used; i < mesh.count; i++) {
      dummy.position.set(0, -20, 0)
      dummy.scale.setScalar(0)
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.count = mesh.instanceMatrix.count
    mesh.instanceMatrix.needsUpdate = true
  }

  private fx(fight: Fight, result: StepResult, dt: number): void {
    if (result.justDodge) {
      const at = this.map(fight.player.x, fight.player.y, fight)
      this.burst(at.x, at.y, 1.2, 0.5, 1, 1, 28, 3.4)
    }
    if (result.hit) {
      const at = this.map(fight.player.x, fight.player.y, fight)
      this.burst(at.x, at.y, 1.2, 1, 0.25, 0.4, 18, 2.4)
    }
    if ((fight.mode === 'dead' || fight.mode === 'clear') && !this.boom) {
      this.boom = true
      const at =
        fight.mode === 'clear'
          ? this.map(fight.w * 0.5, fight.h * config.boss.spawnYFraction, fight)
          : this.map(fight.player.x, fight.player.y, fight)
      this.burst(at.x, at.y, 1, 1, 0.8, 0.3, 40, 3)
    }
    if (fight.mode === 'play') this.boom = false

    const cap = particleCap(this.quality)
    let alive = 0
    for (const spark of this.sparks) {
      if (spark.life <= 0) continue
      spark.life -= dt
      spark.x += spark.vx * dt
      spark.y += spark.vy * dt
      spark.z += spark.vz * dt
      if (alive >= cap) continue
      const fade = Math.max(0, spark.life / spark.max)
      this.sparkPos[alive * 3] = spark.x
      this.sparkPos[alive * 3 + 1] = spark.y
      this.sparkPos[alive * 3 + 2] = spark.z
      this.sparkCol[alive * 3] = spark.r * fade
      this.sparkCol[alive * 3 + 1] = spark.g * fade
      this.sparkCol[alive * 3 + 2] = spark.b * fade
      alive += 1
    }
    for (let i = alive * 3; i < this.sparkPos.length; i++) {
      this.sparkPos[i] = 0
      this.sparkCol[i] = 0
    }
    this.sparkGeo.attributes.position!.needsUpdate = true
    this.sparkGeo.attributes.color!.needsUpdate = true
    this.sparkGeo.setDrawRange(0, alive)
    if (this.sparks.length > cap * 2) {
      this.sparks.splice(0, this.sparks.length - cap)
    }
  }

  private burst(
    x: number,
    y: number,
    z: number,
    r: number,
    g: number,
    b: number,
    count: number,
    speed: number,
  ): void {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + this.clock
      const mag = speed * (0.4 + (i % 5) * 0.12)
      this.sparks.push({
        x,
        y,
        z,
        vx: Math.cos(a) * mag,
        vy: Math.sin(a) * mag,
        vz: ((i % 3) - 1) * 0.4,
        life: 0.28 + (i % 4) * 0.05,
        max: 0.4,
        r,
        g,
        b,
      })
    }
  }

  private shake(fight: Fight): void {
    const amp =
      fight.shakeT > 0 ? (fight.shakeT / config.justDodge.shakeSec) * 0.16 : 0
    const baseX = Math.sin(this.clock * 53) * amp
    const baseY = -0.45 + Math.cos(this.clock * 47) * amp
    this.camera.position.x = baseX
    this.camera.position.y = baseY
  }

  private map(x: number, y: number, fight: Fight): { x: number; y: number } {
    return {
      x: (x / fight.w - 0.5) * config.render.worldSpanX,
      y: (1 - y / fight.h) * config.render.worldSpanY + config.render.worldOriginY,
    }
  }

  private buildCity(): void {
    const body = new InstancedMesh(
      new BoxGeometry(1, 1, 1),
      new MeshBasicMaterial({ color: 0x14081c }),
      40,
    )
    const neon = new InstancedMesh(
      new BoxGeometry(1, 1, 1),
      new MeshBasicMaterial({ color: 0xff2bd6 }),
      40,
    )
    const acid = new InstancedMesh(
      new BoxGeometry(1, 1, 1),
      new MeshBasicMaterial({ color: 0xc6ff4a }),
      40,
    )
    let index = 0
    for (let row = 0; row < 5; row++) {
      for (let side = 0; side < 2; side++) {
        for (let slot = 0; slot < 4; slot++) {
          const height = 0.8 + ((row * 3 + slot * 5) % 6) * 0.45
          const x = (side === 0 ? -1 : 1) * (1.55 + slot * 0.15)
          const y = -0.2 + row * 1.15
          const z = -0.4 - row * 1.35
          dummy.position.set(x, y, z)
          dummy.scale.set(0.7, height, 0.7)
          dummy.rotation.set(0, 0, 0)
          dummy.updateMatrix()
          body.setMatrixAt(index, dummy.matrix)
          dummy.scale.set(0.74, 0.04, 0.74)
          dummy.position.y = y + height * 0.45
          dummy.updateMatrix()
          const strip = (row + slot) % 2 === 0 ? neon : acid
          const other = strip === neon ? acid : neon
          strip.setMatrixAt(index, dummy.matrix)
          dummy.scale.set(0, 0, 0)
          dummy.updateMatrix()
          other.setMatrixAt(index, dummy.matrix)
          index += 1
        }
      }
    }
    body.count = index
    neon.count = index
    acid.count = index
    body.frustumCulled = false
    neon.frustumCulled = false
    acid.frustumCulled = false
    this.scene.add(body)
    this.scene.add(neon)
    this.scene.add(acid)
    const road = new Mesh(
      new BoxGeometry(2.4, 0.04, 16),
      new MeshBasicMaterial({ color: 0x09040f }),
    )
    road.position.set(0, -1.05, -2)
    this.scene.add(road)
  }

  private buildBoss(): void {
    const shell = new Mesh(
      new IcosahedronGeometry(1, 1),
      new MeshBasicMaterial({ color: 0x1a0a22 }),
    )
    shell.scale.set(1.55, 1.15, 1.1)
    const core = new Mesh(new SphereGeometry(0.42, 16, 12), this.coreMat)
    const eye = new Mesh(new BoxGeometry(1.5, 0.12, 0.2), this.eyeMat)
    eye.position.y = 0.15
    const left = new Mesh(new BoxGeometry(0.38, 0.55, 0.38), this.podMat)
    const right = new Mesh(new BoxGeometry(0.38, 0.55, 0.38), this.podMat)
    left.position.set(-1.25, -0.15, 0.2)
    right.position.set(1.25, -0.15, 0.2)
    const ring = new Mesh(
      new TorusGeometry(0.95, 0.035, 8, 24),
      new MeshBasicMaterial({ color: 0x39fff2 }),
    )
    ring.rotation.x = Math.PI / 2.4
    this.boss.add(shell, core, eye, left, right, ring)
    this.boss.scale.setScalar(1.35)
  }

  private buildShip(): void {
    const hull = new Mesh(new ConeGeometry(0.22, 0.62, 4), this.hullMat)
    const left = new Mesh(new BoxGeometry(0.42, 0.08, 0.08), this.wingMat)
    const right = new Mesh(new BoxGeometry(0.42, 0.08, 0.08), this.wingMat)
    left.position.set(-0.28, -0.12, 0)
    right.position.set(0.28, -0.12, 0)
    const engine = new Mesh(
      new SphereGeometry(0.1, 8, 6),
      new MeshBasicMaterial({ color: 0xd6ff4a }),
    )
    engine.position.y = -0.32
    this.ship.add(hull, left, right, engine)
  }
}
