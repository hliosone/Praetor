// The phone as the centre of a page: in 3D when the browser can, as a flat replica otherwise (no WebGL, while the 3D
// code loads, or if it fails at runtime), exactly Sentry's fallback approach. Both draw the same screen.
import { Component, lazy, Suspense, useEffect, useRef, type ReactNode } from 'react';
import { paintScreen, SCREEN_H, SCREEN_W, type PhoneScreen } from './phoneScreen.js';

const Phone3D = lazy(() => import('./Phone3D.js'));

const webgl = () => {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; }
};

class Fallback extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export function FlatPhone({ screen, label }: { screen: PhoneScreen; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (ctx) paintScreen(ctx, screen);
  }, [screen]);
  return (
    <div className="flat-phone" data-testid="phone-flat">
      <canvas ref={ref} width={SCREEN_W} height={SCREEN_H} role="img" aria-label={label} style={{ width: '100%', height: '100%', borderRadius: 30 }} />
    </div>
  );
}

export function PhoneView({ screen, label }: { screen: PhoneScreen; label: string }) {
  const flat = <FlatPhone screen={screen} label={label} />;
  if (!webgl()) return flat;
  return (
    <Fallback fallback={flat}>
      <Suspense fallback={flat}><Phone3D screen={screen} label={label} /></Suspense>
    </Fallback>
  );
}
