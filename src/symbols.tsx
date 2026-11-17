import type { ReactElement } from 'react';
import { FOOTPRINT } from './geometry';
import { PALETTE } from './palette';
import type { ComponentKind } from './types';

const stroke = {
  stroke: PALETTE.ink,
  strokeWidth: 1.6,
  strokeLinejoin: 'round' as const,
  strokeLinecap: 'round' as const,
  vectorEffect: 'non-scaling-stroke' as const,
};

const thin = { ...stroke, strokeWidth: 1.15 };

export function SymbolGraphic({ kind }: { kind: ComponentKind }): ReactElement {
  const { w, d } = FOOTPRINT[kind];
  switch (kind) {
    case 'intake':
      return (
        <g>
          <polygon points={`${-w / 2},${-d / 2 + 0.15} ${-w / 2 + 1.3},${-d / 2} ${w / 2 - 0.2},${-d / 2} ${w / 2 - 0.2},${d / 2} ${-w / 2 + 1.3},${d / 2} ${-w / 2},${d / 2 - 0.15}`} fill={PALETTE.waterLite} {...stroke} />
          <rect x={-w / 2 + 1.5} y={-d / 2 + 0.45} width={w - 2.3} height={d - 0.9} fill={PALETTE.water} opacity={0.85} />
          {[-0.8, -0.25, 0.3].map((offset) => (
            <line key={offset} x1={-w / 2 + 0.35} x2={-w / 2 + 1.15} y1={offset} y2={offset} {...thin} />
          ))}
          <path d={`M ${w / 2 - 1.5} 0 L ${w / 2 - 2.3} -0.38 L ${w / 2 - 2.3} 0.38 Z`} fill={PALETTE.ink} />
        </g>
      );
    case 'bar-screen':
      return (
        <g>
          <rect x={-w / 2} y={-d / 2} width={w} height={d} fill={PALETTE.waterLite} {...stroke} />
          {Array.from({ length: 5 }, (_, index) => {
            const x = -w / 2 + 0.55 + index * ((w - 1.1) / 4);
            return <line key={x} x1={x} x2={x} y1={-d / 2 + 0.28} y2={d / 2 - 0.28} {...thin} />;
          })}
        </g>
      );
    case 'coagulation':
      return (
        <g>
          <circle r={w / 2 - 0.05} fill={PALETTE.waterLite} {...stroke} />
          <circle r={w / 2 - 0.45} fill={PALETTE.water} opacity={0.8} />
          <line x1={-0.85} x2={0.85} {...thin} />
          <line y1={-0.85} y2={0.85} {...thin} />
          <circle r={0.18} fill={PALETTE.ink} />
        </g>
      );
    case 'flocculation':
      return (
        <g>
          <rect x={-w / 2} y={-d / 2} width={w} height={d} rx={0.15} fill={PALETTE.waterLite} {...stroke} />
          {[-2.2, 0, 2.2].map((x, index) => (
            <line key={x} x1={x} x2={x} y1={index % 2 === 0 ? -d / 2 + 0.25 : -d / 2 + 1.3} y2={index % 2 === 0 ? d / 2 - 1.3 : d / 2 - 0.25} {...thin} />
          ))}
        </g>
      );
    case 'sedimentation':
      return (
        <g>
          <rect x={-w / 2} y={-d / 2} width={w} height={d} fill="#e7eef1" {...stroke} />
          <rect x={-w / 2 + 0.25} y={-d / 2 + 0.35} width={w - 1.5} height={d - 0.7} fill={PALETTE.water} opacity={0.55} />
          {[-4, -1.4, 1.2, 3.8].map((x) => (
            <polyline key={x} points={`${x - 0.7},${d / 2 - 0.45} ${x},${-0.2} ${x + 0.7},${d / 2 - 0.45}`} fill="none" {...thin} />
          ))}
          <rect x={w / 2 - 1.15} y={-d / 2 + 0.3} width={0.7} height={d - 0.6} fill="#f7fbfc" {...thin} />
        </g>
      );
    case 'filtration':
      return (
        <g>
          <rect x={-w / 2} y={-d / 2} width={w} height={d} fill="#e7eef1" {...stroke} />
          {[-w / 4, 0, w / 4].map((x) => (
            <line key={x} x1={x} x2={x} y1={-d / 2} y2={d / 2} {...thin} />
          ))}
          {[-3 * (w / 8), -w / 8, w / 8, 3 * (w / 8)].map((x) => (
            <circle key={x} cx={x} r={0.28} fill={PALETTE.sand} {...thin} />
          ))}
        </g>
      );
    case 'disinfection':
      return (
        <g>
          <rect x={-w / 2} y={-d / 2} width={w} height={d} fill="#e5f4ef" {...stroke} />
          <line x1={-w * 0.18} x2={-w * 0.18} y1={-d / 2} y2={d / 2 - 0.7} {...thin} />
          <line x1={w * 0.16} x2={w * 0.16} y1={-d / 2 + 0.7} y2={d / 2} {...thin} />
          <text x={w / 2 - 1.7} y={0.35} fontSize={0.85} fill={PALETTE.paintDark} fontFamily="IBM Plex Mono, monospace">
            Cl₂
          </text>
        </g>
      );
    case 'clearwell':
      return (
        <g>
          <rect x={-w / 2} y={-d / 2} width={w} height={d} rx={0.35} fill="#d5e4ee" {...stroke} />
          <rect x={-w / 2 + 0.45} y={-d / 2 + 0.45} width={w - 0.9} height={d - 0.9} fill={PALETTE.water} opacity={0.55} />
          <circle cx={-w * 0.22} cy={-d * 0.18} r={0.42} fill="#f4f7f8" {...thin} />
        </g>
      );
    case 'finished-pump':
      return (
        <g>
          <circle r={0.95} fill="#f4f7f8" {...stroke} />
          <path d="M -0.15 -0.48 L 0.62 0 L -0.15 0.48 Z" fill={PALETTE.paint} />
          <path d={`M ${-w / 2 + 0.15} 0 L -0.95 0`} fill="none" {...stroke} />
          <path d={`M 0.95 0 L ${w / 2 - 0.15} 0`} fill="none" {...stroke} />
          <rect x={0.15} y={-1.15} width={0.7} height={0.42} fill={PALETTE.steel} {...thin} />
        </g>
      );
    case 'chemical-dosing':
      return (
        <g>
          <rect x={-1.15} y={-0.85} width={1.35} height={1.7} rx={0.12} fill={PALETTE.alum} {...stroke} />
          <rect x={-1.0} y={-0.15} width={1.05} height={0.85} fill={PALETTE.alumDeep} opacity={0.85} />
          <circle cx={0.72} cy={0.35} r={0.38} fill="#f4f7f8" {...stroke} />
          <path d="M 0.72 0.15 L 0.72 0.55 M 0.55 0.35 L 0.9 0.35" fill="none" {...thin} />
        </g>
      );
    case 'sludge':
      return (
        <g>
          <circle r={w / 2 - 0.08} fill={PALETTE.sludgeLite} {...stroke} />
          <circle r={w / 2 - 0.45} fill={PALETTE.sludge} opacity={0.78} />
          <line x1={-w / 2 + 0.15} x2={w / 2 - 0.15} {...stroke} />
          <line x1={-0.7} x2={0.7} y1={0.55} y2={-0.55} {...thin} />
          <circle r={0.2} fill={PALETTE.ink} />
        </g>
      );
    case 'valve':
      return (
        <g>
          <line x1={-w / 2} x2={w / 2} {...stroke} />
          <polygon points="-0.62,-0.42 0,0 -0.62,0.42" fill="#f4f7f8" {...stroke} />
          <polygon points="0.62,-0.42 0,0 0.62,0.42" fill="#f4f7f8" {...stroke} />
        </g>
      );
    case 'pipe':
      return (
        <g>
          <line x1={-w / 2} x2={w / 2} stroke={PALETTE.steelDark} strokeWidth={7} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          <line x1={-w / 2} x2={-w / 2} y1={-0.28} y2={0.28} {...stroke} />
          <line x1={w / 2} x2={w / 2} y1={-0.28} y2={0.28} {...stroke} />
        </g>
      );
    default:
      return <rect x={-1} y={-1} width={2} height={2} fill="none" {...stroke} />;
  }
}
