---
title: "Kubernetes OIDC 인증, 이제 플래그 시대는 끝? (AuthenticationConfiguration로 바뀐 점과 Airgap 고려사항)"
date: "2026-02-13 09:30:00"
slug: k8s-authenticationconfiguration-oidc
---

# Kubernetes OIDC 인증, 이제 플래그 시대는 끝? (AuthenticationConfiguration)

Kubernetes에서 OIDC(OpenID Connect) 기반 사용자 인증을 붙일 때, 많은 분들이 `kube-apiserver`에 `--oidc-*` 플래그를 넣어 설정해왔습니다.

그런데 Kubernetes는 1.30 이후로(점진적 도입) **AuthenticationConfiguration**(구조화된 인증 설정)라는 새로운 방식으로 인증 구성을 파일 기반 API로 옮기고 있습니다. 현재 최신은 1.35이고, 질문 주신 것처럼 1.34에서도 실사용 가능한지 / 기존 OIDC의 Airgap 제약이 개선됐는지 궁금하실 수 있습니다.

이 글에서는:

- 기존 `--oidc-*` 플래그 방식과 AuthenticationConfiguration의 **차이점**
- 1.34에서 **사용 가능 여부(현 시점 기능 상태 기준)**
- Air-gapped(내부 폐쇄망) 환경에서 늘 문제였던 **issuer URL 통신 요구사항이 개선됐는지**

를 기술적으로 정리합니다.

> 참고: 본 글은 Kubernetes 공식 문서의 AuthenticationConfiguration 및 API reference 내용을 기반으로 정리했습니다.
> - Authentication overview: https://kubernetes.io/docs/reference/access-authn-authz/authentication/
> - apiserver config API(v1): https://kubernetes.io/docs/reference/config-api/apiserver-config.v1/

---

## 0) 한 줄 요약

- **AuthenticationConfiguration는 “OIDC를 더 잘 설정하는 방법”**이지, **OIDC가 가진 “apiserver가 issuer에 접근해야 하는 구조” 자체를 없애는 기능은 아닙니다.**
- Kubernetes 1.34 기준으로 AuthenticationConfiguration는 문서상 기능이 성숙(stable로 표기된 항목 포함)해졌고, **1.34에서도 충분히 적용 가능한 구성**입니다.

---

## 1) 기존 OIDC(`--oidc-*`) 방식: 무엇이 불편했나?

전통적으로 apiserver의 OIDC 연동은 이런 플로우입니다.

![legacy oidc flow](https://raw.githubusercontent.com/ddukbg/ddukbg/refs/heads/main/images/k8s-oidc-legacy.png)

### 핵심 포인트

- `kubectl`(클라이언트)은 **ID Token(JWT)** 을 들고 apiserver에 요청합니다.
- apiserver는 토큰 검증을 위해
  - issuer의 **OIDC discovery**(`/.well-known/openid-configuration`)
  - **JWKS(공개키)**
  를 **직접** 조회해서 서명 검증을 합니다.

즉, 많은 운영자들이 겪었던 것처럼:

- **apiserver 입장에서 issuer URL에 네트워크 통신이 가능해야** 합니다.
  - (중요) “클라이언트에서 IdP에 접속해야 한다”가 아니라, **apiserver가 IdP/OIDC discovery endpoint에 접속**해야 합니다.

이 특성 때문에 Airgap에서 OIDC가 항상 까다로웠습니다.

---

## 2) AuthenticationConfiguration란?

AuthenticationConfiguration는 `kube-apiserver`의 인증 설정을 **플래그가 아니라 파일(버전드 API)** 로 구성하는 방식입니다.

공식 API reference에 따르면 AuthenticationConfiguration는 다음을 포함합니다.

- `jwt[]`: JWT/OIDC(정확히는 “OIDC discovery로 키를 찾는 JWT 인증기”) 목록
- `anonymous`: 익명 인증(anonymous)의 세밀한 제어

> v1 API 문서에는 “JWTAuthenticator는 issuer의 공개 엔드포인트에서 OIDC discovery로 키를 찾는다”고 명시되어 있습니다.

### 왜 이게 중요한가?

기존 `--oidc-*` 플래그의 문제는 크게 2가지였습니다.

1) **표현력의 한계**: 1개의 issuer, 제한적인 claim mapping.
2) **운영성/확장성**: 플래그가 많아지고, kubeadm/매니지드 환경에선 변경이 어렵고, 여러 issuer를 운영하기가 곤란.

AuthenticationConfiguration는 이를 “구조화된 스키마”로 해결합니다.

![authnconfig overview](https://raw.githubusercontent.com/ddukbg/ddukbg/refs/heads/main/images/k8s-authnconfig.png)

---

## 3) 기존 방식 vs AuthenticationConfiguration: 차이점 정리

### (A) 단일 issuer → 다중 JWTAuthenticator

- 기존 플래그 방식은 기본적으로 “한 번에 한 issuer”로 쓰는 패턴이 일반적입니다.
- AuthenticationConfiguration는 `jwt:` 배열을 통해 **여러 issuer(또는 여러 audience/규칙)를 명시적으로 분리**할 수 있습니다.

### (B) Claim 매핑/검증의 구조화

v1beta1/v1 스펙에는 claim mapping, 그리고 표현식 기반(문서에 CEL 표현식 언급) 검증/추출 기능이 포함됩니다.
즉, 단순히 `--oidc-username-claim` / `--oidc-groups-claim`만으로는 부족했던

- 이메일 검증(email_verified)
- 특정 claim 존재/형식 검증
- extra field 매핑

같은 요구를 더 “정식”으로 구성할 수 있게 됩니다.

### (C) Anonymous 제어의 고도화 (특히 1.34 stable 표기)

Authentication 문서에는 1.34 기준으로:

- AuthenticationConfiguration로 **anonymous authenticator**를 구성할 수 있고
- 단순 enable/disable 뿐 아니라 **어떤 path만 익명 허용**할지까지 제한 가능

이라고 명시되어 있습니다.

(예: `/livez`, `/readyz`, `/healthz`만 익명 허용)

> Source: https://kubernetes.io/docs/reference/access-authn-authz/authentication/ (Anonymous authenticator configuration 섹션)

---

## 4) 1.34에서 사용 가능한가?

결론적으로 “가능”에 가깝습니다.

- 문서에서 **Kubernetes v1.34 stable** 표기가 등장(특히 anonymous 설정)
- apiserver config API에는 `apiserver.config.k8s.io/v1`로 AuthenticationConfiguration 리소스가 존재

즉, 1.34는 **AuthenticationConfiguration를 본격적으로 운영에 쓰기 좋은 버전대**로 보는 것이 합리적입니다.

다만, 실제 적용 시에는 환경별로 다음을 확인하는 것을 권장합니다.

- apiserver 실행 인자에 `--authentication-config=/path/to/authn.yaml`(혹은 동등 옵션) 지원 여부
- kubeadm/매니지드(kops, EKS, GKE 등)에서 해당 옵션을 주입할 수 있는지

---

## 5) Airgap(폐쇄망)에서 issuer URL 통신 요구사항, 개선됐나?

**근본적으로는 그대로입니다.**

AuthenticationConfiguration의 JWTAuthenticator 역시 “OIDC discovery로 issuer의 공개키를 찾는다”는 모델을 따릅니다.
즉:

- apiserver가 issuer의 discovery/JWKS endpoint에 접근할 수 있어야 검증이 됩니다.

### 그럼 Airgap에서는 어떻게 운영하나?

개선 포인트는 “OIDC 통신이 없어졌다”가 아니라, **통신 경로를 더 명확히 통제/설계할 수 있다**는 쪽에 가깝습니다.

권장 패턴은 아래 중 하나입니다.

#### (1) 내부(IdP)로 issuer를 가져온다
- 외부 IdP를 직접 붙이지 않고, **내부에 OIDC issuer(또는 mirror)를 둔다**

#### (2) DMZ egress proxy로 apiserver outbound를 한 곳으로 모은다
- apiserver → (DMZ proxy) → issuer
- 방화벽 정책/감사/allowlist를 DMZ에 집중

![airgap egress](https://raw.githubusercontent.com/ddukbg/ddukbg/refs/heads/main/images/k8s-airgap-egress.png)

> 이 방식은 이전에 작성한 “폐쇄망 K8s egress” 패턴과 동일하게 적용할 수 있습니다.

#### (3) egress selector / 네트워크 정책으로 apiserver의 외부 통신을 고정
apiserver의 외부 통신이 필요하다면, 최소한

- “어디로 나가는지”
- “어떤 프로토콜/포트로 나가는지”

를 기술적으로 고정해야 합니다.

---

## 6) 예시: AuthenticationConfiguration (개념)

아래는 개념 예시입니다(필드는 버전/환경에 맞게 조정 필요).

```yaml
apiVersion: apiserver.config.k8s.io/v1
kind: AuthenticationConfiguration
jwt:
  - issuer:
      url: https://issuer.example.com
    audiences:
      - kubernetes
    claimMappings:
      username:
        claim: sub
        prefix: ""
      groups:
        claim: groups
        prefix: ""
anonymous:
  enabled: true
  conditions:
    - path: /livez
    - path: /readyz
    - path: /healthz
```

---

## 7) 결론

- AuthenticationConfiguration는 기존 OIDC 플래그를 **더 구조화/확장 가능하게 대체**하는 방향입니다.
- 1.34는 문서 기준으로 안정화된 요소가 등장하고(v1.34 stable 표기), 운영 적용 가능성이 높습니다.
- Airgap에서 “issuer 통신 필요”는 **본질적으로 남아있으며**, 해결은
  - 내부 issuer 운영
  - DMZ proxy/egress selector로 outbound 통제
  같은 네트워크 설계로 접근하는 것이 현실적입니다.

다음 글에서는 실제로 kubeadm 기반 클러스터에서 `--authentication-config`를 주입하는 방법(정적 파드 매니페스트 수정)과,
issuer/JWKS 경로를 DMZ로 고정하는 예시를 더 구체적으로 정리해보겠습니다.
