---
title: "Polymarket 차익거래(Arbitrage) 봇 구축을 위한 기술 분석 및 설계"
date: "2026-02-12 10:00:00"
slug: polymarket-arbitrage-bot-design
---

# Polymarket 차익거래(Arbitrage) 봇 구축: 기술 분석부터 설계까지

최근 예측 시장(Prediction Market)인 **Polymarket**의 거래량이 폭발적으로 증가했습니다. 단순한 도박을 넘어, 금융 상품으로서의 성격이 짙어지면서 필연적으로 **차익거래(Arbitrage)** 기회가 발생하고 있습니다.

이 글에서는 Polymarket의 기술적 기반인 **Gnosis CTF(Conditional Tokens Framework)** 메커니즘을 심층 분석하여 차익거래 원리를 파악하고, 이를 자동화할 **HFT(High Frequency Trading) 봇**의 설계 계획을 정리합니다.

---

## 1. 핵심 원리: CTF와 Atomic Arbitrage

Polymarket은 단순한 베팅 사이트가 아닙니다. 이더리움(Polygon) 상의 스마트 컨트랙트인 **CTF(Conditional Tokens Framework)** 위에서 작동합니다.

### Split & Merge 메커니즘

모든 마켓은 **담보(Collateral, 주로 USDC)**를 기반으로 파생된 토큰을 거래합니다.

- **Split (발행)**: 1 USDC를 락업하면, 모든 가능한 결과(예: Yes + No)의 토큰을 각각 1개씩 받습니다.
  - `1 USDC → 1 Yes Token + 1 No Token`
- **Merge (상환)**: 모든 결과의 토큰을 1개씩 모아서 가져오면, 다시 1 USDC로 바꿀 수 있습니다.
  - `1 Yes Token + 1 No Token → 1 USDC`

### 차익거래 기회 (The Opportunity)

이 메커니즘 덕분에, 시장 가격의 합이 **1$**와 다를 때 무위험 차익거래가 가능합니다.

1.  **Minting Arb (가격 합 > 1$)**
    - 시장에서 Yes가 $0.6, No가 $0.5에 거래된다고 가정 (합 $1.1)
    - **전략**: 1 USDC로 (Yes+No)를 Minting → 시장에 각각 매도 → $1.1 수익 (ROI 10%)
2.  **Burn/Redeem Arb (가격 합 < 1$)**
    - 시장에서 Yes가 $0.4, No가 $0.5에 거래된다고 가정 (합 $0.9)
    - **전략**: 시장에서 Yes, No를 각각 매수($0.9 소요) → Merge하여 1 USDC 상환 → $0.1 수익

> **현실적인 제약**: Polymarket은 오더북(CLOB) 기반이므로, **Taker Fee**와 **Slippage**를 고려해야 합니다. 따라서 `(Price_Yes + Price_No + Fees) < 1.0` 인 순간을 포착하는 것이 핵심입니다.

---

## 2. 봇 구축 전략 (Bot Strategy)

단순한 스크립트로는 경쟁력이 없습니다. 오더북의 갭을 밀리초(ms) 단위로 캐치해야 합니다.

### 타겟 전략: Negative Risk Arbitrage

최근 Polymarket은 여러 결과 중 하나만 실현되는(Mutually Exclusive) **Negative Risk** 마켓을 지원합니다. (예: "공화당 후보는 누구?" - 트럼프/헤일리/디샌티스 등)

- **기회**: 10명의 후보가 있을 때, 각 후보 토큰 가격의 합이 $0.95라면?
- **액션**: 10개 토큰을 전부 시장가 매수 → Merge → 5% 확정 수익.
- **난이도**: 슬리피지 계산과 Execution 속도가 생명.

---

## 3. 시스템 아키텍처 설계

이 봇은 안정성과 속도를 위해 **Python** 기반의 비동기 마이크로서비스 아키텍처로 설계합니다.

### Tech Stack
- **Language**: Python 3.11+ (`asyncio`)
- **SDK**: `py-clob-client` (Polymarket 공식 CLOB 클라이언트)
- **Chain**: Polygon RPC (Alchemy/Infura) - *CTF Mint/Redeem용*
- **DB**: TimescaleDB (틱 데이터 저장 및 백테스팅)

### Architecture Diagram

![Polymarket Bot Architecture](https://raw.githubusercontent.com/ddukbg/ddukbg/refs/heads/main/images/polymarket-bot-arch.png)

1.  **Market Data Service**: CLOB Websocket을 통해 수천 개 마켓의 오더북(L2 Data)을 실시간 수신.
2.  **Strategy Engine**: 메모리 내에서 `Sum(Ask_Prices)`를 계산. 임계값(예: 0.99) 이하로 떨어지면 트리거.
3.  **Risk Manager**: 현재 잔고(USDC)와 가스비를 고려해 진입 가능 여부 판단.
4.  **Execution Service**:
    - **Atomic Transaction**이 중요. 매수 후 즉시 Merge가 불가능할 수 있음(포지션 홀딩 리스크).
    - 1단계: CLOB API로 토큰 매수 (Fill or Kill)
    - 2단계: CTF 컨트랙트 호출 (Merge/Redeem)

---

## 4. 운영 계획 (Roadmap)

### Phase 1: Paper Trading (모의 투자)
- 실제 자금 투입 없이, 실시간 데이터만 수신하며 `가상 체결` 시뮬레이션.
- 슬리피지와 수수료를 보수적으로 적용하여 수익성 검증.

### Phase 2: Live Trading (Small Cap)
- **뱅크롤**: 100 USDC
- **대상**: 유동성이 적어 스프레드가 큰 롱테일 마켓(정치 외 이슈 등).
- **목표**: 일일 승률 90% 이상, MDD(Maximum Drawdown) 1% 미만.

### Phase 3: Scaling & Optimization
- Rust로 코어 로직 포팅 고려 (Latency 단축).
- Polygon 노드 직접 운영 (RPC 레이턴시 최소화).

---

## 결론

Polymarket 차익거래는 단순한 코딩이 아니라, **블록체인 메커니즘(CTF)과 전통적 HFT(CLOB)의 결합**입니다. 시장 효율성이 높아질수록 기회는 줄어들겠지만, 틈새 시장(Long-tail Markets)에는 여전히 기회가 있습니다.

다음 글에서는 실제 **Python 봇 코드의 핵심 파트(CLOB 연동, 시세 포착 로직)**를 공개하고, 모의 투자 성과를 공유하겠습니다.
