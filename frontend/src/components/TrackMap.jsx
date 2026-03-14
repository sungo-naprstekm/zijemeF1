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
      <div className="track-map-header">
        <h3>{trackOutline.circuit_name || 'Mapa trati'}</h3>
      </div>
      <div className="track-map-svg-wrapper">
        <svg viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid meet" className="track-svg">
          {/* Obrys trati */}
          {svgPath && (
            <path
              d={svgPath}
              className="track-outline-path"
              fill="none"
              stroke="rgba(255, 255, 255, 0.2)"
              strokeWidth="15"
              strokeLinejoin="round"
            />
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
          background: rgba(10, 10, 15, 0.8);
          border: 1px solid rgba(0, 243, 255, 0.3);
          border-radius: 12px;
          padding: 15px;
          margin-bottom: 20px;
          box-shadow: 0 0 20px rgba(0, 0, 0, 0.5);
          position: relative;
          overflow: hidden;
        }

        .track-map-header h3 {
          margin: 0 0 10px 0;
          font-size: 0.9rem;
          color: #00f3ff;
          text-transform: uppercase;
          letter-spacing: 1px;
        }

        .track-map-svg-wrapper {
          width: 100%;
          aspect-ratio: 1 / 1;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .track-svg {
          width: 100%;
          height: 100%;
          filter: drop-shadow(0 0 5px rgba(0, 243, 255, 0.2));
        }

        .track-outline-path {
          filter: drop-shadow(0 0 2px rgba(255, 255, 255, 0.1));
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
