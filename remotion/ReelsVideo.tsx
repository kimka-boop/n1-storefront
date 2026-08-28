/**
 * [v3] ReelsVideo — 여성 착용샷 4컷 15초 릴스
 * public/look_*.jpg 필요. 1080x1920, 30fps, 450프레임.
 * 구성: 오프닝타이틀(1.5s) → 착용샷 4컷(각 3s) → 엔딩 CTA(1.5s)
 */
import React from 'react';
import {
  AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, Sequence, spring, useVideoConfig,
} from 'remotion';

const LOOKS = [
  {img: 'look_PRD-W-01.jpg', label: 'RED KNIT CARDIGAN', price: '₩31,500', fg: '#C0282C'},
  {img: 'look_PRD-W-03.jpg', label: 'SATIN BLOUSE', price: '₩27,900', fg: '#8C6A4F'},
  {img: 'look_PRD-W-11.jpg', label: 'WIDE SLACKS', price: '₩27,900', fg: '#2B3A55'},
  {img: 'look_PRD-W-12.jpg', label: 'NAVY SLACKS', price: '₩29,900', fg: '#2B3A55'},
];

const OPEN = 45;   // 1.5s 오프닝
const SEG = 90;    // 각 착용샷 3초
const TOTAL = 450;

const Opening: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const opacity = interpolate(frame, [0, 20, OPEN - 15, OPEN], [0, 1, 1, 0]);
  const y = interpolate(spring({frame, fps, config: {damping: 200}}), [0, 1], [50, 0]);
  return (
    <AbsoluteFill style={{backgroundColor: '#111', justifyContent: 'center', alignItems: 'center', opacity}}>
      <div style={{color: '#fff', textAlign: 'center', transform: `translateY(${y}px)`, fontFamily: 'Helvetica, sans-serif'}}>
        <div style={{fontSize: 30, letterSpacing: 14, marginBottom: 20}}>N°1</div>
        <div style={{fontSize: 96, fontWeight: 700, lineHeight: 1.1}}>2026 F/W<br/>WOMEN'S EDIT</div>
        <div style={{fontSize: 30, marginTop: 24, opacity: 0.8, letterSpacing: 6}}>SELECTED BY AI</div>
      </div>
    </AbsoluteFill>
  );
};

const LookSlide: React.FC<{look: (typeof LOOKS)[0]}> = ({look}) => {
  const frame = useCurrentFrame();
  const local = frame;
  const opacity = interpolate(local, [0, 18, SEG - 18, SEG], [0, 1, 1, 0], {
    extrapolateLeft: false, extrapolateRight: false,
  });
  const scale = interpolate(local, [0, SEG], [1.08, 1.0]);
  const textY = interpolate(spring({frame: local - 5, fps: 30, config: {damping: 200}}), [0, 1], [40, 0]);

  return (
    <AbsoluteFill style={{backgroundColor: '#111', opacity}}>
      <Img src={staticFile(look.img)} style={{width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${scale})`}} />
      <AbsoluteFill style={{background: 'linear-gradient(180deg, transparent 58%, rgba(0,0,0,0.75) 100%)'}} />
      <AbsoluteFill style={{justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 160}}>
        <div style={{color: '#fff', textAlign: 'center', fontFamily: 'Helvetica, sans-serif', transform: `translateY(${textY}px)`}}>
          <div style={{fontSize: 26, letterSpacing: 12, marginBottom: 14, opacity: 0.85}}>N°1</div>
          <div style={{fontSize: 66, fontWeight: 700, letterSpacing: 2}}>{look.label}</div>
          <div style={{fontSize: 40, marginTop: 12, color: look.fg === '#2B3A55' ? '#AAB8D0' : '#F0C8C8'}}>{look.price}</div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Ending: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 20], [0, 1]);
  const shimmer = spring({frame, fps: 30, config: {damping: 200}});
  return (
    <AbsoluteFill style={{backgroundColor: '#111', justifyContent: 'center', alignItems: 'center', opacity}}>
      <div style={{color: '#fff', textAlign: 'center', fontFamily: 'Helvetica, sans-serif'}}>
        <div style={{fontSize: 34, letterSpacing: 14, marginBottom: 28, opacity: 0.85}}>N°1</div>
        <div style={{fontSize: 74, fontWeight: 700, transform: `scale(${interpolate(shimmer, [0, 1], [0.92, 1])})`}}>
          지금 쇼핑하기
        </div>
        <div style={{fontSize: 30, marginTop: 20, opacity: 0.7, letterSpacing: 4}}>20 PIECES. SELECTED BY AI.</div>
      </div>
    </AbsoluteFill>
  );
};

export const ReelsVideo: React.FC = () => {
  return (
    <AbsoluteFill style={{backgroundColor: '#111', width: 1080, height: 1920, overflow: 'hidden'}}>
      <Sequence from={0} durationInFrames={OPEN}>
        <Opening />
      </Sequence>
      {LOOKS.map((look, i) => (
        <Sequence key={look.img} from={OPEN + i * SEG} durationInFrames={SEG}>
          <LookSlide look={look} />
        </Sequence>
      ))}
      <Sequence from={OPEN + LOOKS.length * SEG} durationInFrames={TOTAL - (OPEN + LOOKS.length * SEG)}>
        <Ending />
      </Sequence>
    </AbsoluteFill>
  );
};
