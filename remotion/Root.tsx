/**
 * N°1 — Remotion 릴스 루트 (3호기 렌더링 파이프라인)
 * 15초 세로 릴스 (1080x1920, 30fps, 450프레임)
 * 에이전트가 생성한 ReelsVideo.tsx를 시드 컴포넌트로 렌더링한다.
 */
import {Composition} from 'remotion';
import {ReelsVideo} from './ReelsVideo';

export const RemotionRoot = () => {
  return (
    <Composition
      id="Reels"
      component={ReelsVideo}
      durationInFrames={450}
      fps={30}
      width={1080}
      height={1920}
    />
  );
};
