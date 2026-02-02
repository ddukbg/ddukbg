---
title: "Nginx Ingress에서 Gateway API(HTTPRoute)로 이관하기: 실전 마이그레이션 가이드"
date: "2025-11-12 16:20:00"
slug: nginx-ingress-to-gateway-api-migration
description: "Ingress(NGINX) 기반 라우팅을 Gateway API(Gateway/HTTPRoute)로 전환하는 체크리스트와 예제 (TLS, path rewrite, canary, 정책, 관측성 포함)"
---

# Nginx Ingress에서 Gateway API(HTTPRoute)로 이관하기

> 요약: “Nginx Ingress가 당장 ‘갑자기’ 사라진다”기보다는, **Kubernetes 네트워킹 표준이 Ingress → Gateway API로 이동**하고 있고, 일부 배포판/조합에서는 **Ingress 컨트롤러 유지보수·정책 변화·운영 부담**이 커지면서 Gateway API 기반으로의 전환이 점점 더 합리적인 선택이 되고 있습니다.
>
> 이 글은 **NGINX Ingress(ingress-nginx) 사용 클러스터**를 기준으로, **Gateway API(Gateway/HTTPRoute)** 로 안전하게 이관하는 실전 가이드입니다.

---

## 0) 왜 Gateway API인가?

Ingress는 “간단한 HTTP 라우팅”에는 좋지만, 다음과 같은 한계가 있습니다.

- **표현력 부족**: 세밀한 라우팅(헤더/메서드/쿼리), 트래픽 분할, 정책 적용 등은 컨트롤러별 annotation에 의존
- **역할 분리 어려움**: 네트워크 플랫폼 팀(게이트웨이 운영)과 앱 팀(라우팅 선언) 경계가 애매
- **표준화 부족**: controller마다 annotation/CRD가 달라 이관이 어려움

Gateway API는 이를 개선합니다.

- **표준 CRD**: `GatewayClass`, `Gateway`, `HTTPRoute`, `ReferenceGrant` 등
- **역할 분리**: 플랫폼 팀은 `Gateway`/LB/인증서, 앱 팀은 `HTTPRoute`
- **확장성**: 정책(Policy) 리소스, 트래픽 분할, 멀티 게이트웨이 시나리오에 유리

---

## 1) 현재 Ingress 리소스/기능 인벤토리 만들기

이관 전에 “우리가 무엇을 쓰고 있는지”를 먼저 명확히 해야 합니다.

### 1-1. Ingress 목록

```bash
kubectl get ingress -A
kubectl get ingress -A -o yaml > all-ingress.yaml
```

### 1-2. NGINX Ingress 주요 annotation 사용 여부 점검

예:
- `nginx.ingress.kubernetes.io/rewrite-target`
- `nginx.ingress.kubernetes.io/ssl-redirect`
- `nginx.ingress.kubernetes.io/proxy-body-size`
- `nginx.ingress.kubernetes.io/canary`, `canary-weight`
- `nginx.ingress.kubernetes.io/auth-*` (basic, oauth2-proxy)

이 annotation들이 Gateway API에서 **어떤 표준/확장 기능으로 치환되는지**가 핵심입니다.

---

## 2) Gateway API 설치 (CRD + Controller)

Gateway API는 CRD만 설치한다고 동작하지 않습니다. **Gateway API를 구현하는 컨트롤러**가 필요합니다.

### 선택지 예시
- **NGINX Gateway Fabric** (NGINX 기반 Gateway API)
- **Cilium Gateway API** (Cilium/eBPF 스택과 결합)
- **Envoy Gateway** (Envoy 기반)
- **Istio** (Gateway API 지원)
- 클라우드 LB 컨트롤러(예: AWS Load Balancer Controller)는 Ingress/EKS ALB 중심이므로 조합/요구사항에 따라 판단

> 여기서는 “개념과 매니페스트 구조”를 기준으로 설명합니다. 실제 컨트롤러 설치 방식(Helm 값 등)은 사용 솔루션에 맞춰 적용하세요.

---

## 3) Ingress → HTTPRoute 매핑 규칙

### 3-1. Ingress의 핵심 요소
- Host (`spec.rules.host`)
- Path (`spec.rules.http.paths`)
- Backend Service/Port
- TLS (`spec.tls`)

### 3-2. Gateway API의 핵심 요소
- `GatewayClass`: 어떤 컨트롤러가 관리하는지
- `Gateway`: 실제 “진입점”(Listener: HTTP/HTTPS, port, hostname)
- `HTTPRoute`: 라우팅 규칙(호스트/경로/헤더/백엔드)

---

## 4) 예제: 단순 Ingress를 HTTPRoute로 바꾸기

### 기존 Ingress 예시

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: app
  namespace: app
spec:
  ingressClassName: nginx
  rules:
  - host: app.example.com
    http:
      paths:
      - path: /api
        pathType: Prefix
        backend:
          service:
            name: app-svc
            port:
              number: 80
  tls:
  - hosts:
    - app.example.com
    secretName: app-tls
```

### Gateway + HTTPRoute로 전환

#### (1) GatewayClass (플랫폼 팀 영역)

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: GatewayClass
metadata:
  name: my-gwclass
spec:
  controllerName: example.io/gateway-controller
```

> `controllerName`은 사용하는 Gateway 컨트롤러 문서에 맞춰야 합니다.

#### (2) Gateway (플랫폼 팀 영역)

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: edge
  namespace: gateway
spec:
  gatewayClassName: my-gwclass
  listeners:
  - name: https
    protocol: HTTPS
    port: 443
    hostname: app.example.com
    tls:
      mode: Terminate
      certificateRefs:
      - kind: Secret
        name: app-tls
        namespace: app
```

**주의:** 다른 네임스페이스의 Secret을 참조하려면 컨트롤러/정책에 따라 `ReferenceGrant`가 필요할 수 있습니다.

#### (3) ReferenceGrant (필요 시)

```yaml
apiVersion: gateway.networking.k8s.io/v1beta1
kind: ReferenceGrant
metadata:
  name: allow-gateway-to-app-tls
  namespace: app
spec:
  from:
  - group: gateway.networking.k8s.io
    kind: Gateway
    namespace: gateway
  to:
  - group: ""
    kind: Secret
```

#### (4) HTTPRoute (앱 팀 영역)

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: app-route
  namespace: app
spec:
  parentRefs:
  - name: edge
    namespace: gateway
  hostnames:
  - app.example.com
  rules:
  - matches:
    - path:
        type: PathPrefix
        value: /api
    backendRefs:
    - name: app-svc
      port: 80
```

---

## 5) 자주 쓰는 NGINX annotation 대체 전략

### 5-1. SSL Redirect
- NGINX: `nginx.ingress.kubernetes.io/ssl-redirect: "true"`
- Gateway API: 보통 HTTPS listener만 열고 HTTP listener는 301 redirect 정책(컨트롤러별)로 처리

**패턴**
- `Gateway`에 `HTTP(80)` + `HTTPS(443)` 둘 다 Listener를 만들고
- HTTP는 Redirect 정책으로 HTTPS로 이동

> Redirect는 표준화 진행 중인 영역이거나 컨트롤러별 Policy로 제공됩니다.

### 5-2. Rewrite Target
- NGINX: `rewrite-target: /$1` 등
- Gateway API: `URLRewrite` 필터로 처리(지원 컨트롤러일 때)

```yaml
filters:
- type: URLRewrite
  urlRewrite:
    path:
      type: ReplacePrefixMatch
      replacePrefixMatch: /
```

### 5-3. Canary / Traffic Split
- NGINX canary annotation
- Gateway API: `backendRefs`에 `weight`로 트래픽 분할

```yaml
backendRefs:
- name: app-svc
  port: 80
  weight: 90
- name: app-svc-canary
  port: 80
  weight: 10
```

---

## 6) 운영 관점 체크리스트

### 6-1. 롤아웃 전략
1) Gateway API 컨트롤러를 **기존 Ingress와 병행 설치**
2) 신규 도메인/경로부터 HTTPRoute로 전환
3) 동일 도메인 전환 시에는
   - DNS/ALB/LB 레벨에서 트래픽을 분할하거나
   - 기존 Ingress/새 Gateway로 **별도 엔드포인트**를 만들고 단계적 이동

### 6-2. 관측성/로깅
- 기존: NGINX access log
- 전환 후: 컨트롤러별 metrics/log + (가능하면) OpenTelemetry

### 6-3. 정책/보안
- WAF, rate-limit, auth, IP allowlist 등은 컨트롤러별 Policy로 구현되는 경우가 많습니다.
- “표준 CRD + 컨트롤러 정책” 조합을 문서화해두면 팀 간 운영이 쉬워집니다.

---

## 7) 결론

Ingress는 여전히 널리 쓰이지만, **표준화·확장성·역할 분리** 측면에서 Gateway API가 점점 더 주류가 되고 있습니다.

- Ingress → Gateway API 전환의 핵심은
  1) 리소스 매핑(Host/Path/TLS)
  2) annotation 의존 기능의 치환(Rewrite/Redirect/Canary/Policy)
  3) 운영 전략(병행 → 단계적 전환)

다음 글에서는 실제로 **ingress-nginx → (예: Envoy Gateway / Cilium Gateway API / NGINX Gateway Fabric)** 중 하나를 선택해, Helm 값과 실운영 구성을 좀 더 “현실적인 매니페스트”로 정리해 보겠습니다.

---
