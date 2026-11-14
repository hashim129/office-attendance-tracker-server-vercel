import React, { useEffect, useRef, useState } from 'react';

/** Number that rolls up (or down) smoothly to its new value. */
export const CountUp: React.FC<{
  value: number;
  duration?: number;
  decimals?: number;
  className?: string;
}> = ({ value, duration = 900, decimals = 0, className }) => {
  const [shown, setShown] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const from = fromRef.current;
    if (reduce || from === value) {
      setShown(value);
      fromRef.current = value;
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = from + (value - from) * eased;
      setShown(v);
      fromRef.current = v;
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return <span className={className} style={{ fontVariantNumeric: 'tabular-nums' }}>{shown.toFixed(decimals)}</span>;
};
