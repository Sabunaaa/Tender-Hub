import { useEffect, useRef } from 'react'
import * as THREE from 'three'

type ParticleWaveProps = {
  className?: string
}

/**
 * Fullscreen particle wave for the access screen.
 * Fresh canvas each mount — WebGL context cannot be reused after dispose() (React Strict Mode).
 */
export function ParticleWave({ className = '' }: ParticleWaveProps) {
  const mountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    let disposed = false
    let animationId = 0

    const getSize = () => ({
      width: Math.max(1, mount.clientWidth || window.innerWidth),
      height: Math.max(1, mount.clientHeight || window.innerHeight),
    })

    const { width, height } = getSize()

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.01, 1000)
    camera.position.set(0, 6, 5)

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setClearColor(0x000000, 1)
    renderer.setSize(width, height, false)

    const canvas = renderer.domElement
    canvas.style.cssText = 'display:block;width:100%;height:100%;'
    canvas.setAttribute('aria-hidden', 'true')
    mount.replaceChildren(canvas)

    const gap = 0.3
    const amountX = 200
    const amountY = 200
    const count = amountX * amountY
    const positions = new Float32Array(count * 3)
    const scales = new Float32Array(count)

    let i = 0
    let j = 0
    for (let ix = 0; ix < amountX; ix++) {
      for (let iy = 0; iy < amountY; iy++) {
        positions[i] = ix * gap - (amountX * gap) / 2
        positions[i + 1] = 0
        positions[i + 2] = iy * gap - (amountX * gap) / 2
        scales[j] = 1
        i += 3
        j += 1
      }
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('scale', new THREE.BufferAttribute(scales, 1))

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Vector3(1, 1, 1) },
      },
      vertexShader: `
        attribute float scale;
        uniform float uTime;
        void main() {
          vec3 p = position;
          float s = scale;
          p.y += (sin(p.x + uTime) * 0.5) + (cos(p.y + uTime) * 0.1) * 2.0;
          p.x += sin(p.y + uTime) * 0.5;
          s += (sin(p.x + uTime) * 0.5) + (cos(p.y + uTime) * 0.1) * 2.0;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = max(1.5, s * 15.0 * (1.0 / -mvPosition.z));
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        void main() {
          vec2 uv = gl_PointCoord - vec2(0.5);
          float alpha = 1.0 - smoothstep(0.35, 0.5, length(uv));
          if (alpha < 0.02) discard;
          gl_FragColor = vec4(uColor, alpha * 0.55);
        }
      `,
    })

    const particles = new THREE.Points(geometry, material)
    scene.add(particles)

    const syncSize = () => {
      if (disposed) return
      const next = getSize()
      camera.aspect = next.width / next.height
      camera.updateProjectionMatrix()
      renderer.setSize(next.width, next.height, false)
    }

    const tick = () => {
      if (disposed) return
      material.uniforms.uTime.value += 0.05
      camera.lookAt(0, 0, 0)
      renderer.render(scene, camera)
      animationId = requestAnimationFrame(tick)
    }

    syncSize()
    tick()
    requestAnimationFrame(syncSize)

    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(syncSize) : null
    observer?.observe(mount)
    window.addEventListener('resize', syncSize)

    return () => {
      disposed = true
      cancelAnimationFrame(animationId)
      observer?.disconnect()
      window.removeEventListener('resize', syncSize)
      scene.remove(particles)
      geometry.dispose()
      material.dispose()
      renderer.dispose()
      mount.replaceChildren()
    }
  }, [])

  return <div ref={mountRef} className={className} aria-hidden />
}
