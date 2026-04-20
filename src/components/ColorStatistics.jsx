import React, { useMemo } from 'react';
import './ColorStatistics.css';

// Helper to convert RGB to HSL
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h * 360, s * 100, l * 100];
}

const HUE_BUCKETS = [
  { name: 'Red', range: [345, 15], color: '#FF3B30' },
  { name: 'Orange', range: [15, 45], color: '#FF9500' },
  { name: 'Yellow', range: [45, 75], color: '#FFCC00' },
  { name: 'Lime', range: [75, 105], color: '#4CD964' },
  { name: 'Green', range: [105, 165], color: '#28CD41' },
  { name: 'Cyan', range: [165, 195], color: '#5AC8FA' },
  { name: 'Blue', range: [195, 255], color: '#007AFF' },
  { name: 'Purple', range: [255, 315], color: '#5856D6' },
  { name: 'Pink', range: [315, 345], color: '#FF2D55' }
];

const ACHROMATIC_BUCKETS = [
  { name: 'Black', color: '#1a1a1a', check: (h, s, l) => l < 20 },
  { name: 'Gray', color: '#8e8e93', check: (h, s, l) => s < 15 && l >= 20 && l <= 80 },
  { name: 'White', color: '#f2f2f7', check: (h, s, l) => l > 80 }
];

export default function ColorStatistics({ pieces, stats }) {
  const bucketsData = useMemo(() => {
    // Initialize results
    const results = [
       ...ACHROMATIC_BUCKETS.map(b => ({ ...b, total: 0, filled: 0, type: 'achromatic' })),
       ...HUE_BUCKETS.map(b => ({ ...b, total: 0, filled: 0, type: 'chromatic' }))
    ];

    pieces.forEach(p => {
      const [r, g, b] = p.targetRGB;
      const [h, s, l] = rgbToHsl(r, g, b);
      
      let targetBucket = null;

      // Check Achromatic first
      for (const bucket of results.filter(b => b.type === 'achromatic')) {
        if (bucket.check(h, s, l)) {
          targetBucket = bucket;
          break;
        }
      }

      // Check Chromatic if not achromatic
      if (!targetBucket) {
        for (const bucket of results.filter(b => b.type === 'chromatic')) {
           const [start, end] = bucket.range;
           if (start > end) { // Red wraps around 360
             if (h >= start || h < end) targetBucket = bucket;
           } else {
             if (h >= start && h < end) targetBucket = bucket;
           }
           if (targetBucket) break;
        }
      }

      if (targetBucket) {
        targetBucket.total++;
        if (p.state === 'filled') targetBucket.filled++;
      }
    });

    return results.filter(b => b.total > 0); // Only show used buckets
  }, [pieces]);

  const overallPercent = ((stats.filled / stats.total) * 100).toFixed(1);

  return (
    <div className="color-dashboard">
      <div className="dashboard-header">
        <div className="overall-stat">
          <span className="stat-value">{overallPercent}%</span>
          <span className="stat-label">完成進度</span>
        </div>
        <div className="divider"></div>
        <div className="overall-stat">
          <span className="stat-value">{stats.uniquePhotos}</span>
          <span className="stat-label">所用素材數</span>
        </div>
      </div>

      <div className="hue-ring">
        {bucketsData.map(bucket => {
          const percent = (bucket.filled / bucket.total) * 100;
          return (
            <div key={bucket.name} className="hue-node" title={`${bucket.name}: ${bucket.filled}/${bucket.total}`}>
              <div className="node-circle-wrap">
                 <svg viewBox="0 0 36 36" className="circular-chart">
                    <path className="circle-bg"
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    />
                    <path className="circle"
                      strokeDasharray={`${percent}, 100`}
                      style={{ stroke: bucket.color }}
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    />
                 </svg>
                 <div className="node-center" style={{ backgroundColor: bucket.color }}></div>
              </div>
              <span className="node-label">{percent.toFixed(0)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
