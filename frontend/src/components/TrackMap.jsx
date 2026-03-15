import React, { useMemo } from 'react';
import { useF1Store } from '../store/useF1Store';

const TrackMap = () => {
  const { trackOutline, positions, leaderboard } = useF1Store();

  const svgPath = useMemo(() => {
    if (!trackOutline || !trackOutline.points || trackOutline.points.length === 0) return null;
    
    // Create SVG path string: M x y L x y L x y ... Z
    const pts = trackOutline.points;
    const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z';
    return d;
  }, [trackOutline]);

  if (!trackOutline) {
    return (
      <div className="track-map-container loading">
        <label>Načítám mapu trati...</label>
      </div>
    );
  }

  return (
    <div className="track-map-container">
      <div className="track-map-svg-wrapper">
        <svg viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid meet" className="track-svg">
          {/* Obrys trati */}
          {svgPath && (
            <g>
              <path
                d={svgPath}
                className="track-outline-path"
                fill="none"
                stroke="url(#trackGradient)"
                strokeWidth="12"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              
              <defs>
                <linearGradient id="trackGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="rgba(255, 255, 255, 0.4)" />
                  <stop offset="100%" stopColor="rgba(255, 255, 255, 0.1)" />
                </linearGradient>
              </defs>
            </g>
          )}

          {/* Body jezdců */}
          {Object.entries(positions).map(([driverNum, pos]) => {
            const driverInfo = leaderboard.find(l => l.driver_number === driverNum);
            const color = driverInfo?.team_color || '#FFFFFF';
            const name = driverInfo?.broadcast_name || driverNum;

            return (
              <g 
                key={driverNum} 
                className="driver-dot-group"
                style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
              >
                <circle
                  cx="0"
                  cy="0"
                  r="12"
                  fill={color}
                  className="driver-dot"
                />
                <text
                  x="18"
                  y="5"
                  className="driver-label"
                  fill="white"
                  fontSize="24"
                  fontWeight="bold"
                >
                  {name}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <style jsx>{`
        .track-map-container {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .track-map-svg-wrapper {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
        }

        .track-svg {
          width: 100%;
          height: 100%;
          max-width: 100%;
          max-height: 100%;
        }

        .track-outline-path {
          filter: drop-shadow(0 0 8px rgba(255, 255, 255, 0.3)) drop-shadow(0 0 24px rgba(14, 165, 233, 0.2));
        }

        .driver-dot {
          stroke: black;
          stroke-width: 2;
          transition: all 0.3s ease-out;
        }

        .driver-label {
          text-shadow: 0 2px 4px rgba(0, 0, 0, 0.8);
          pointer-events: none;
        }

        .driver-dot-group {
          transition: transform 0.3s ease-out;
        }

        .loading {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 200px;
          color: rgba(255, 255, 255, 0.5);
          font-style: italic;
        }
      `}</style>
    </div>
  );
};

export default TrackMap;
