export default function ToneFrame({ tones }: { tones: string[] }) {
  const [from, to] = tones;
  return (
    <div
      aria-label="Tone placeholder"
      style={{
        width: "100%",
        aspectRatio: "3 / 4",
        background: `linear-gradient(135deg, ${from} 0%, ${to} 100%)`,
      }}
    />
  );
}