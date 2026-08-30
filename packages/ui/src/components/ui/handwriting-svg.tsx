"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { cn } from "../../lib/utils";

const DEFAULT_FONT_URL =
  "https://raw.githubusercontent.com/google/fonts/main/ofl/indieflower/IndieFlower-Regular.ttf";

interface HandwritingSvgProps {
  path?: string;
  text?: string;
  fontUrl?: string;
  className?: string;
  strokeClassName?: string;
  duration?: number;
  delay?: number;
  strokeWidth?: number;
  width?: number;
  height?: number;
  fontSize?: number;
  ease?: "linear" | "easeIn" | "easeOut" | "easeInOut";
  /** Fired once the drawable path is resolved (or instantly when `path` is given). Memoize to avoid re-runs. */
  onReady?: () => void;
}

export function HandwritingSvg({
  path: pathProp,
  text,
  fontUrl = DEFAULT_FONT_URL,
  className,
  strokeClassName,
  duration = 2,
  delay = 0.5,
  strokeWidth = 2,
  width = 100,
  height = 100,
  fontSize = 48,
  ease = "easeInOut",
  onReady,
}: HandwritingSvgProps) {
  const [path, setPath] = useState<string | null>(pathProp ?? null);
  const [viewBox, setViewBox] = useState(`0 0 ${width} ${height}`);
  const [loading, setLoading] = useState(!!text && !pathProp);

  useEffect(() => {
    if (!text || pathProp) {
      setPath(pathProp ?? null);
      setViewBox(`0 0 ${width} ${height}`);
      setLoading(false);
      if (pathProp) onReady?.();
      return;
    }

    let cancelled = false;

    setLoading(true);

    (async () => {
      try {
        const [buffer, opentype] = await Promise.all([
          fetch(fontUrl).then((res) => {
            if (!res.ok) {
              throw new Error(`Font request failed with status ${res.status}`);
            }
            return res.arrayBuffer();
          }),
          import("opentype.js"),
        ]);

        if (cancelled) return;

        const p = opentype.parse(buffer).getPath(text, 0, fontSize, fontSize);

        const bbox = p.getBoundingBox();

        const pad = 5;

        const vx = Math.floor(bbox.x1) - pad;
        const vy = Math.floor(bbox.y1) - pad;
        const vw = Math.ceil(bbox.x2 - bbox.x1) + pad * 2;
        const vh = Math.ceil(bbox.y2 - bbox.y1) + pad * 2;

        setViewBox(`${vx} ${vy} ${vw} ${vh}`);

        setPath(p.toPathData(2));

        onReady?.();
      } catch (err) {
        console.error("HandwritingSvg: failed to load font", err);
        if (!cancelled) {
          setPath(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [text, fontUrl, pathProp, fontSize, width, height, onReady]);

  if (loading) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={cn("text-muted-foreground", className)}
        aria-hidden={true}
      >
        <title>Handwriting SVG loading</title>

        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={14}
        >
          Loading…
        </text>
      </svg>
    );
  }

  const d = path ?? "";

  if (!d) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={cn("text-muted-foreground", className)}
        aria-hidden={true}
      >
        <title>Handwriting SVG</title>

        {text ? (
          <text
            x="50%"
            y="50%"
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={fontSize}
            fill="currentColor"
          >
            {text}
          </text>
        ) : (
          <text
            x="50%"
            y="50%"
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={12}
          >
            Provide path or text
          </text>
        )}
      </svg>
    );
  }

  const svgViewBox = pathProp ? `0 0 ${width} ${height}` : viewBox;

  return (
    <svg
      width={width}
      height={height}
      viewBox={svgViewBox}
      className={cn("text-rose-500", className)}
      aria-hidden={true}
    >
      <title>Handwriting SVG</title>

      <motion.path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={strokeClassName}
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{
          delay,
          duration,
          ease,
        }}
      />
    </svg>
  );
}

export default HandwritingSvg;
