import { useLayoutEffect, useRef, useState } from 'react';

const DAMPING = 0.9;
const STIFFNESS = 400;
const THRESHOLD = 0.001;

function springValue(start, target, seconds) {
  const decay = -DAMPING * Math.sqrt(STIFFNESS);
  const frequency = Math.sqrt(STIFFNESS * (1 - DAMPING ** 2));
  const displacement = start - target;
  const sine = -decay * displacement / frequency;
  const angle = frequency * seconds;
  const envelope = Math.exp(decay * seconds);
  const offset = envelope * (displacement * Math.cos(angle) + sine * Math.sin(angle));
  return {
    value: Math.min(1, Math.max(0, target + offset)),
    offset,
    velocity: decay * offset + envelope * frequency * (-displacement * Math.sin(angle) + sine * Math.cos(angle)),
  };
}

function springFrames(start, target) {
  const samples = [];
  let seconds = 0;
  while (true) {
    const sample = springValue(start, target, seconds);
    const done = Math.abs(sample.offset) <= THRESHOLD && Math.abs(sample.velocity) <= THRESHOLD * 1000 / 16;
    samples.push({ seconds, value: done ? target : sample.value });
    if (done) break;
    seconds += 1 / 60;
  }
  return { samples, duration: seconds * 1000 };
}

export function useMobileDrawerMotion(shown, viewportWidth) {
  const surface = useRef(null);
  const progress = useRef(shown ? 1 : 0);
  const motion = useRef(null);
  const [present, setPresent] = useState(shown);
  const [moving, setMoving] = useState(false);
  useLayoutEffect(() => {
    const root = surface.current;
    const front = root.querySelector('.mobile-front-surface');
    const drawer = root.querySelector('.mobile-drawer');
    const shadow = root.querySelector('.mobile-front-shadow');
    const scrim = root.querySelector('.mobile-drawer-scrim');
    const width = Math.min(root.clientWidth * .8, 326);
    const target = shown ? 1 : 0;
    const start = progress.current;
    const frontTransform = value => `translateX(${width * value}px) scale(${1 - .05 * value})`;
    const drawerTransform = value => `translateX(${width * (value - 1)}px) scale(${.95 + .05 * value})`;
    const write = value => {
      progress.current = value;
      front.style.transform = value === 0 ? 'none' : frontTransform(value);
      if (drawer) drawer.style.transform = drawerTransform(value);
      shadow.style.opacity = value;
      if (scrim) scrim.style.opacity = .2 * (1 - value);
    };
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (preference?.matches || Math.abs(target - start) <= THRESHOLD) {
      write(target); setPresent(shown); setMoving(false); return;
    }
    setPresent(true); setMoving(true);
    const { samples, duration } = springFrames(start, target);
    const options = { duration, easing: 'linear', fill: 'both' };
    const keyframes = getProperties => samples.map(sample => ({ offset: sample.seconds * 1000 / duration, ...getProperties(sample.value) }));
    const animations = [
      front.animate(keyframes(value => ({ transform: frontTransform(value) })), options),
      drawer.animate(keyframes(value => ({ transform: drawerTransform(value) })), options),
      shadow.animate(keyframes(value => ({ opacity: value })), options),
      scrim.animate(keyframes(value => ({ opacity: .2 * (1 - value) })), options),
    ];
    const active = { animations };
    motion.current = active;
    function finish() {
      if (motion.current !== active) return;
      write(target);
      motion.current = null;
      animations.forEach(animation => animation.cancel());
      setPresent(shown); setMoving(false);
    }
    Promise.all(animations.map(animation => animation.finished)).then(finish, () => {});
    const reduce = event => {
      if (event.matches) finish();
    };
    preference?.addEventListener('change', reduce);
    return () => {
      preference?.removeEventListener('change', reduce);
      if (motion.current !== active) return;
      const seconds = (animations[0].currentTime ?? 0) / 1000;
      write(springValue(start, target, seconds).value);
      motion.current = null;
      animations.forEach(animation => animation.cancel());
    };
  }, [shown, viewportWidth]);
  return { surface, moving, present: shown || present };
}
