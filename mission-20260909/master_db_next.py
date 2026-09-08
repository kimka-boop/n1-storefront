#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""N1 LAUNCH 20260910 — MASTER_DB_NEXT 스테이징 작성 + 검증 (STEP 13-14)
입력: catalog_selected.json + pairing_results.json (stdin 불가 — 시트 쓰기가 목적이므로
      실행 인자로 파일 2개 경로를 받지 않고, cwd의 파일명 리터럴만 사용)
절차 (§28): WRITE STAGING → READBACK → VALIDATE → (swap은 별도 스크립트)
기존 Products/Orders/Users/Refunds 절대 건드리지 않는다.
새 탭: MASTER_DB_NEXT_20260909 (staging), Pairs (pair mapping)"""
import json, os, sys
from google.oauth2 import service_account
from googleapiclient.discovery import build

SPREADSHEET_TITLE = "[Master DB] 무재고 위탁판매 관리시스템"
STAGING_TAB = "MASTER_DB_NEXT_20260909"
PAIRS_TAB = "Pairs"

BASE_HEADERS = ["상품ID", "상품명", "카테고리", "공급사명", "공급사코드", "공급사URL",
                "매입가", "판매가", "마진율", "재고상태", "룩북상태", "갱신일",
                "룩북이미지URL", "소재", "세탁정보", "실측사이즈", "모델정보",
                "두께감", "신축성", "비침", "안감", "핏감", "원산지", "제조자",
                "제조연월", "색상옵션", "fit_profile", "unisex_score", "성별"]
EXT_HEADERS = ["raw_name", "trend_cluster_ids", "selection_reason_internal",
               "pair_ready", "primary_pair_id", "pair_score", "pair_reason",
               "data_quality", "audit_status", "image_status", "publish_ready"]

def get_sheets_service():
    email = os.environ["GOOGLE_SERVICE_ACCOUNT_EMAIL"]
    key = os.environ["GOOGLE_PRIVATE_KEY"].replace("\\n", "\n")
    info = {"type": "service_account", "client_email": email, "private_key": key,
            "token_uri": "https://oauth2.googleapis.com/token"}
    creds = service_account.Credentials.from_service_account_info(
        info, scopes=["https://www.googleapis.com/auth/spreadsheets"])
    return build("sheets", "v4", credentials=creds), os.environ["N1_SHEET_ID"]

def main():
    cat = json.load(open("catalog_selected.json", encoding="utf-8"))
    prs = json.load(open("pairing_results.json", encoding="utf-8"))
    pair_of = {}
    for p in prs["pairs"]:
        if p["tier"] != "BELOW_THRESHOLD":
            pair_of[p["top_product_id"]] = (p["pair_id"], p["pair_score_internal"], p["pair_reason_short"])
            pair_of[p["bottom_product_id"]] = (p["pair_id"], p["pair_score_internal"], p["pair_reason_short"])
    svc, sheet_id = get_sheets_service()
    meta = svc.spreadsheets().get(spreadsheetId=sheet_id).execute()
    titles = [s["properties"]["title"] for s in meta["sheets"]]
    if STAGING_TAB in titles:
        svc.spreadsheets().values().clear(spreadsheetId=sheet_id, range=STAGING_TAB).execute()
    else:
        svc.spreadsheets().batchUpdate(spreadsheetId=sheet_id, body={
            "requests": [{"addSheet": {"properties": {"title": STAGING_TAB}}}]}).execute()
    now = "2026-09-09"
    rows = [BASE_HEADERS + EXT_HEADERS]
    for c in cat["catalog"]:
        pid, pscore, preason = pair_of.get(c["product_id"], ("", "", ""))
        clusters = ",".join(c["cluster_ids"])
        reason = "evidence: " + (clusters if clusters else "베이스 유연성 보완")
        quality = "PARTIAL"  # 소재·옵션 고시 미확인 — UNKNOWN 필드 존재
        rows.append([
            c["product_id"], c["name"], c["top_bottom"], "도매꾹", c["source_product_id"],
            c["source_url"], c["cost"], c["retail"], c["margin_pct"], "판매중", "대기",
            now, c["source_image"] or "", c["material"], c["care"], "UNKNOWN", "UNKNOWN",
            "UNKNOWN", "UNKNOWN", "UNKNOWN", "UNKNOWN", "UNKNOWN",
            c["origin"], c["manufacturer"], c["madeAt"],
            ",".join(c["colors"]) or "UNKNOWN",
            "", "", c["gender"],
            c["raw_name"], clusters, reason,
            "YES" if pid else "SOLO", pid, pscore, preason,
            quality, "PENDING_HERMES_REVIEW", "SOURCE_ONLY", "TRUE" if clusters else "TRUE",
        ])
    svc.spreadsheets().values().update(
        spreadsheetId=sheet_id, range=f"{STAGING_TAB}!A1",
        valueInputOption="USER_ENTERED", body={"values": rows}).execute()
    # Pairs 탭
    pair_rows = [["pair_id", "collection_scope", "top_product_id", "bottom_product_id",
                  "pair_score_internal", "tier", "trend_clusters", "pair_reason_short",
                  "generated_at"]]
    for p in prs["pairs"]:
        pair_rows.append([p["pair_id"], p["collection_scope"], p["top_product_id"],
                          p["bottom_product_id"], p["pair_score_internal"], p["tier"],
                          ",".join(p["trend_clusters"]), p["pair_reason_short"], p["generated_at"]])
    if PAIRS_TAB in titles:
        svc.spreadsheets().values().clear(spreadsheetId=sheet_id, range=PAIRS_TAB).execute()
    else:
        svc.spreadsheets().batchUpdate(spreadsheetId=sheet_id, body={
            "requests": [{"addSheet": {"properties": {"title": PAIRS_TAB}}}]}).execute()
    svc.spreadsheets().values().update(
        spreadsheetId=sheet_id, range=f"{PAIRS_TAB}!A1",
        valueInputOption="USER_ENTERED", body={"values": pair_rows}).execute()
    # READBACK 검증
    got = svc.spreadsheets().values().get(spreadsheetId=sheet_id, range=STAGING_TAB).execute()["values"]
    assert got[0] == rows[0], "header mismatch"
    assert len(got) == len(rows) == 45, f"row count {len(got)}"
    errors = []
    ids = set()
    for r in got[1:]:
        ids.add(r[0])
        if not r[1] or not r[3] or not r[7] or not r[29]:
            errors.append(f"{r[0]}: 필수값 결손")
    assert len(ids) == 44, "duplicate product_id"
    if errors:
        print("VALIDATE ERRORS:", errors)
        sys.exit(1)
    print(f"STAGING OK: {len(got)-1} products, headers={len(rows[0])}, pairs={len(pair_rows)-1}")

if __name__ == "__main__":
    main()
