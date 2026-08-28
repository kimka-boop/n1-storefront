export type Product = {
  name: string;
  category: string;
  tone: string;
  price: number | "PRICE PENDING";
  toneframe: [string, string];
  concept: string;
  product_id: string;
  supplier_url: string;
  tryon: string | null;
};

export const products: Product[] = [
  {
    name: "여자 간절기 가을 두툼한 루즈핏 V넥 니트 가디건 레드",
    category: "의류-상의",
    tone: "레드",
    price: 31500,
    toneframe: ["#C0282C", "#FAF9F7"],
    concept: "레드 톤 위탁판매 상품",
    product_id: "PRD-W-01",
    supplier_url: "https://www.domeggook.com/41244409",
    tryon: "https://cdn.fashn.ai/445ecd7e-b787-424d-8a8b-dcbbe723c0eb/product_to_model_0.jpeg",
  },
  {
    name: "가을 니트 래빗 꽈배기 가디건 네이비 간절기 캐주얼",
    category: "의류-상의",
    tone: "네이비",
    price: 17900,
    toneframe: ["#2B3A55", "#FAF9F7"],
    concept: "네이비 톤 위탁판매 상품",
    product_id: "PRD-W-02",
    supplier_url: "https://www.domeggook.com/50689558",
    tryon: "https://cdn.fashn.ai/29c6d597-c882-49fa-b0ab-c1538a4fef53/product_to_model_0.jpeg",
  },
  {
    name: "여자 실크 새틴 블라우스 베이지 오피스 하객룩",
    category: "의류-상의",
    tone: "베이지",
    price: 27900,
    toneframe: ["#E8DFD3", "#FAF9F7"],
    concept: "베이지 톤 위탁판매 상품",
    product_id: "PRD-W-03",
    supplier_url: "https://www.domeggook.com/44559427",
    tryon: null,
  },
  {
    name: "로맨틱 레이스 퍼프 블라우스 꽃무늬 크림 셔츠",
    category: "의류-상의",
    tone: "Ivory",
    price: 22900,
    toneframe: ["#D8D3CB", "#FAF9F7"],
    concept: "Ivory 톤 위탁판매 상품",
    product_id: "PRD-W-04",
    supplier_url: "https://www.domeggook.com/55005533",
    tryon: null,
  },
  {
    name: "여성 반집업 카라 니트 버터화이트 긴팔 스웨터",
    category: "의류-상의",
    tone: "화이트",
    price: 27900,
    toneframe: ["#F5F3EF", "#FAF9F7"],
    concept: "화이트 톤 위탁판매 상품",
    product_id: "PRD-W-05",
    supplier_url: "https://www.domeggook.com/61816771",
    tryon: null,
  },
];