// The phone that approves, in 3D (spec 07): the human's authority, so it is the hero. Built like BSA Sentry's
// Flex3D (docs/PREEXISTING.md): no imported model, a rounded body, a camera island, side buttons, and a screen whose
// texture is painted from live state. Loaded lazily; PhoneView swaps in a flat replica without WebGL, and the motion
// stops for prefers-reduced-motion.
import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import { paintScreen, SCREEN_H, SCREEN_W, type PhoneScreen } from './phoneScreen.js';

function Phone({ screen, still }: { screen: PhoneScreen; still: boolean }) {
  const group = useRef<THREE.Group>(null);
  const aspect = useThree((st) => st.size.width / Math.max(1, st.size.height));
  const fit = Math.min(1, aspect / 0.62);
  const canvas = useMemo(() => Object.assign(document.createElement('canvas'), { width: SCREEN_W, height: SCREEN_H }), []);
  const texture = useMemo(() => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, [canvas]);

  useEffect(() => {
    const draw = () => { paintScreen(canvas.getContext('2d')!, screen); texture.needsUpdate = true; };
    draw();
    void document.fonts?.ready.then(draw);
  }, [canvas, texture, screen]);

  useFrame(({ clock }) => {
    if (!group.current || still) return;
    const t = clock.getElapsedTime();
    group.current.rotation.y = -0.25 + Math.sin(t * 0.35) * 0.28;
    group.current.rotation.x = -0.05 + Math.sin(t * 0.27) * 0.03;
  });

  return (
    <group ref={group} rotation={[-0.05, -0.25, 0]} scale={fit}>
      <RoundedBox args={[1.9, 3.9, 0.22]} radius={0.28} smoothness={8}>
        <meshStandardMaterial color="#2b2e33" roughness={0.35} metalness={0.75} />
      </RoundedBox>
      <mesh position={[0, 0, 0.112]}>
        <planeGeometry args={[1.74, 3.68]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
      {/* Camera island on the back. */}
      <RoundedBox args={[0.7, 0.7, 0.06]} radius={0.12} position={[-0.45, 1.35, -0.13]}>
        <meshStandardMaterial color="#1d1f23" roughness={0.3} metalness={0.6} />
      </RoundedBox>
      {/* Side buttons. */}
      <RoundedBox args={[0.04, 0.5, 0.08]} radius={0.015} position={[0.97, 0.8, 0]}>
        <meshStandardMaterial color="#3a3d43" roughness={0.3} metalness={0.8} />
      </RoundedBox>
      <RoundedBox args={[0.04, 0.32, 0.08]} radius={0.015} position={[-0.97, 1.0, 0]}>
        <meshStandardMaterial color="#3a3d43" roughness={0.3} metalness={0.8} />
      </RoundedBox>
    </group>
  );
}

export default function Phone3D({ screen, label }: { screen: PhoneScreen; label: string }) {
  const still = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  return (
    <Canvas camera={{ position: [0, 0, 7.4], fov: 38 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }} aria-label={label} role="img">
      <ambientLight intensity={0.5} />
      <directionalLight position={[3, 4, 5]} intensity={1.3} />
      <directionalLight position={[-4, -2, 2]} intensity={0.45} color="#cfd6ff" />
      {/* Rim light from behind, so the body separates from the black stage. */}
      <directionalLight position={[0, 2, -5]} intensity={2.4} />
      <pointLight position={[-3, 3, -2]} intensity={6} distance={9} />
      <Phone screen={screen} still={still} />
      <ContactShadows position={[0, -2.2, 0]} opacity={0.5} scale={6} blur={2.6} far={3} color="#000" />
    </Canvas>
  );
}
