import React from 'react';

// Decorative background: swirling music staves with notes scattered across them.
// The layout never changes, so every path and note position is worked out once at load.

const WIDTH = 1600;
const HEIGHT = 1000;
const LINE_SPACING = 11;  // Gap between the five lines of a staff
const BAR_LENGTH = 270;   // Distance along a staff between bar lines
const STEM_X = 6.4;       // Stems attach to the right edge of a note head (left edge when pointing down)
const STEM_LENGTH = 32;
const BEAM_GAP = 24;      // Distance between two notes joined by a beam
const NOTE_COLORS = ['var(--green)', 'var(--pink)', 'var(--yellow)', 'var(--cyan)', 'var(--purple)'];

// Each staff follows a wavy centerline. A `loop` above 1 curls it into loop-de-loops.
const STAVES = [
  { y: 150, tilt: 0.1, amplitude: 60, wavelength: 760, phase: 0.4, loop: 0, colors: ['var(--pink)', 'var(--purple)'] },
  { y: 520, tilt: -0.12, amplitude: 70, wavelength: 560, phase: 5.16, loop: 2, colors: ['var(--green)', 'var(--cyan)'] },
  { y: 870, tilt: 0.06, amplitude: 55, wavelength: 900, phase: 4.1, loop: 0, colors: ['var(--yellow)', 'var(--pink)'] },
];

// The notes in one bar, as fractions of the way through it
const RHYTHMS = [
  [{ at: 0.3, type: 'quarter' }, { at: 0.7, type: 'quarter' }],
  [{ at: 0.5, type: 'eighth' }],
  [{ at: 0.2, type: 'beamed' }, { at: 0.75, type: 'quarter' }],
  [{ at: 0.35, type: 'half' }, { at: 0.75, type: 'eighth' }],
  [],  // An empty bar now and then keeps things airy
];

// Seeded random numbers, so the notes land in the same places on every visit
let seed = 20;
const random = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};
const pick = (items) => items[Math.floor(random() * items.length)];
const randomStep = (lowest, highest) => lowest + Math.floor(random() * (highest - lowest + 1));

const T_START = -300;
const T_END = WIDTH + 300;
const SAMPLES = 1500;

const centerline = (staff, t) => {
  const omega = (2 * Math.PI) / staff.wavelength;
  const angle = omega * t + staff.phase;
  return {
    x: t + (staff.loop / omega) * Math.cos(angle),
    y: staff.y + staff.tilt * (t - WIDTH / 2) + staff.amplitude * Math.sin(angle),
  };
};

// The point `offset` px across the staff from its centerline (negative is toward
// the top line), and the direction the staff is heading there in degrees
const pointOnStaff = (staff, t, offset = 0) => {
  const before = centerline(staff, t - 0.5);
  const after = centerline(staff, t + 0.5);
  const dx = after.x - before.x;
  const dy = after.y - before.y;
  const length = Math.hypot(dx, dy);
  const center = centerline(staff, t);
  return {
    x: center.x - (dy / length) * offset,
    y: center.y + (dx / length) * offset,
    angle: (Math.atan2(dy, dx) * 180) / Math.PI,
  };
};

// Records how far along the curve each sample is, so bar lines and notes
// can be spaced evenly even where the staff speeds through a loop
const buildArcTable = (staff) => {
  const table = [{ t: T_START, length: 0 }];
  let previous = centerline(staff, T_START);
  for (let i = 1; i <= SAMPLES; i++) {
    const t = T_START + ((T_END - T_START) * i) / SAMPLES;
    const point = centerline(staff, t);
    table.push({ t, length: table[i - 1].length + Math.hypot(point.x - previous.x, point.y - previous.y) });
    previous = point;
  }
  return table;
};

const tAtLength = (table, length) => {
  let low = 0;
  let high = table.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (table[middle].length < length) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  const end = table[low];
  const start = table[Math.max(low - 1, 0)];
  const span = end.length - start.length;
  return span ? start.t + ((length - start.length) / span) * (end.t - start.t) : end.t;
};

const toPath = (points) => `M${points.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L')}`;

const isOnScreen = ({ x, y }) => x > -40 && x < WIDTH + 40 && y > -40 && y < HEIGHT + 40;

// `step` counts half line-gaps up from the middle line: 4 is the top line, -4 the bottom
const placeNote = (staff, table, length, step) =>
  pointOnStaff(staff, tAtLength(table, length), (-step * LINE_SPACING) / 2);

const buildStaff = (staff) => {
  const table = buildArcTable(staff);
  const totalLength = table[table.length - 1].length;

  const sampleTs = [];
  for (let length = 0; length <= totalLength; length += 6) {
    sampleTs.push(tAtLength(table, length));
  }
  const lines = [-2, -1, 0, 1, 2].map((line) =>
    toPath(sampleTs.map((t) => pointOnStaff(staff, t, line * LINE_SPACING)))
  );

  let bars = '';
  const notes = [];
  for (let barStart = BAR_LENGTH / 2; barStart + BAR_LENGTH <= totalLength; barStart += BAR_LENGTH) {
    const t = tAtLength(table, barStart);
    bars += toPath([pointOnStaff(staff, t, -2 * LINE_SPACING), pointOnStaff(staff, t, 2 * LINE_SPACING)]);

    pick(RHYTHMS).forEach(({ at, type }) => {
      const length = barStart + at * BAR_LENGTH;
      const step = type === 'beamed' ? randomStep(-4, -1) : randomStep(-4, 4);
      const note = { ...placeNote(staff, table, length, step), type, step };

      if (type === 'beamed') {
        // Find the second note on the curve, then describe it relative to the first one
        const nextStep = Math.max(Math.min(step + pick([-1, 1, 2]), 0), -4);
        const next = placeNote(staff, table, length + BEAM_GAP, nextStep);
        const radians = (note.angle * Math.PI) / 180;
        const dx = next.x - note.x;
        const dy = next.y - note.y;
        note.next = {
          x: dx * Math.cos(radians) + dy * Math.sin(radians),
          y: -dx * Math.sin(radians) + dy * Math.cos(radians),
        };
      }

      if (isOnScreen(note)) {
        notes.push({ ...note, color: pick(NOTE_COLORS), delay: random() * 5 });
      }
    });
  }

  return { lines, bars, notes, colors: staff.colors };
};

const STAFF_DRAWINGS = STAVES.map(buildStaff);
const NOTES = STAFF_DRAWINGS.flatMap((staff) => staff.notes);

const NoteHead = ({ x = 0, y = 0, hollow = false }) => (
  <ellipse
    cx={x}
    cy={y}
    rx={7.2}
    ry={5.2}
    transform={`rotate(-20 ${x} ${y})`}
    fill={hollow ? 'none' : 'currentColor'}
    stroke="currentColor"
    strokeWidth={hollow ? 2.2 : 0}
  />
);

const Stem = ({ x, from, to }) => (
  <line x1={x} y1={from} x2={x} y2={to} stroke="currentColor" strokeWidth={2} />
);

// Drawn with the staff running left to right and "up" being toward the top line
const Note = ({ type, step, next }) => {
  if (type === 'beamed') {
    const firstTop = -STEM_LENGTH;
    const secondTop = next.y - STEM_LENGTH;
    return (
      <>
        <NoteHead />
        <NoteHead x={next.x} y={next.y} />
        <Stem x={STEM_X} from={-1} to={firstTop} />
        <Stem x={next.x + STEM_X} from={next.y - 1} to={secondTop} />
        <path
          d={`M${STEM_X - 1},${firstTop}L${next.x + STEM_X + 1},${secondTop}l0,5L${STEM_X - 1},${firstTop + 5}Z`}
          fill="currentColor"
        />
      </>
    );
  }

  // Like in sheet music, stems point up below the middle line and down from it upward
  const direction = step < 0 ? -1 : 1;
  const stemX = direction < 0 ? STEM_X : -STEM_X;
  const stemEnd = direction * STEM_LENGTH;
  return (
    <>
      <NoteHead hollow={type === 'half'} />
      <Stem x={stemX} from={direction} to={stemEnd} />
      {type === 'eighth' && (
        <path
          d={`M${stemX},${stemEnd}c1,${-direction * 8} 11,${-direction * 10} 8,${-direction * 22}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.4}
          strokeLinecap="round"
        />
      )}
    </>
  );
};

const MusicBackground = () => (
  <div className="music-background" aria-hidden="true">
    {/* Staves and notes are separate layers so the bouncing notes don't make the browser redraw the staves */}
    <svg className="music-background__layer" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="xMidYMid slice">
      <defs>
        {STAFF_DRAWINGS.map((staff, index) => (
          <linearGradient
            key={index}
            id={`staff-gradient-${index}`}
            gradientUnits="userSpaceOnUse"
            x1="0"
            y1="0"
            x2={WIDTH}
            y2="0"
          >
            <stop offset="0" style={{ stopColor: staff.colors[0] }} />
            <stop offset="1" style={{ stopColor: staff.colors[1] }} />
          </linearGradient>
        ))}
      </defs>
      {STAFF_DRAWINGS.map((staff, index) => (
        <g key={index} className="staff" stroke={`url(#staff-gradient-${index})`} fill="none">
          {staff.lines.map((line, lineIndex) => (
            <path key={lineIndex} d={line} strokeWidth={1.6} />
          ))}
          <path d={staff.bars} strokeWidth={2} />
        </g>
      ))}
    </svg>
    <svg className="music-background__layer" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="xMidYMid slice">
      {NOTES.map((note, index) => (
        <g key={index} transform={`translate(${note.x.toFixed(1)} ${note.y.toFixed(1)}) rotate(${note.angle.toFixed(1)})`}>
          {/* Negative delays start each note partway through its bounce, so they don't move in sync */}
          <g className="note" style={{ color: note.color, animationDelay: `${-note.delay}s` }}>
            <Note {...note} />
          </g>
        </g>
      ))}
    </svg>
  </div>
);

export default MusicBackground;
