export default function Skeleton({ height = 160 }: { height?: number }) {
  return <div className="skeleton" style={{ height }} />;
}
