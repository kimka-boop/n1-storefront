import type { Product } from "@/lib/products";
import ToneFrame from "@/components/ToneFrame";

function formatPrice(price: Product["price"]): string {
  if (price === "PRICE PENDING") return "PRICE PENDING";
  return `${price.toLocaleString("ko-KR")} KRW`;
}

export default function ProductGrid({ products }: { products: Product[] }) {
  return (
    <section
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        gap: "2.5rem",
        padding: "4rem 6vw",
      }}
    >
      {products.map((product) => (
        <article key={product.product_id}>
          <div style={{ marginBottom: "1rem" }}>
            {product.tryon ? (
              <img
                src={product.tryon}
                alt={product.name}
                style={{ width: "100%", height: "auto" }}
              />
            ) : (
              <ToneFrame tones={product.toneframe} />
            )}
          </div>
          <p
            style={{
              fontSize: "0.7rem",
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              color: "#888",
              marginBottom: "0.4rem",
            }}
          >
            {product.category} — {product.tone}
          </p>
          <h2
            style={{
              fontSize: "0.95rem",
              fontWeight: 500,
              lineHeight: 1.5,
              marginBottom: "0.5rem",
            }}
          >
            {product.name}
          </h2>
          <p style={{ fontSize: "0.85rem", fontWeight: 600 }}>
            {formatPrice(product.price)}
          </p>
          <a
            href={product.supplier_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-block",
              marginTop: "0.6rem",
              fontSize: "0.7rem",
              letterSpacing: "0.1em",
              borderBottom: "1px solid #111",
              paddingBottom: "2px",
            }}
          >
            SUPPLIER ↗
          </a>
        </article>
      ))}
    </section>
  );
}