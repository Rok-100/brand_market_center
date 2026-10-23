import { useEffect, useRef, useState } from "react";
import "./learning-center.css";

export function LearningCenter({ active = true }: { active?: boolean }) {
  const [opened, setOpened] = useState(active);
  const frame = useRef<HTMLIFrameElement>(null);
  const notifyVisibility = () => frame.current?.contentWindow?.postMessage({ type: "wis-learning-visibility", active }, window.location.origin);
  useEffect(() => { if (active) setOpened(true); notifyVisibility(); }, [active]);
  if (!opened) return null;
  return (
    <main className="learning-center-module" aria-label="学习中心" hidden={!active}>
      <iframe ref={frame} onLoad={notifyVisibility} title="学习中心" src={window.location.pathname.replace(/\/?$/u, '/') + 'learning/'} allow="fullscreen" />
    </main>
  );
}
