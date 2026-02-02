---
title: "Kube-proxy 없이 살아가기: Cilium을 활용한 성능 최적화와 구성 가이드"
date: 2025-08-14 14:30:00
slug: cilium-kube-proxy-free
---

# Kube-proxy 없이 살아가기: Cilium을 활용한 성능 최적화

Kubernetes 클러스터를 운영하다 보면 필연적으로 **네트워킹 성능**과 **확장성** 문제에 부딪히게 됩니다. 그 중심에는 늘 `kube-proxy`가 있습니다. 기본적으로 제공되는 컴포넌트지만, 서비스 개수가 늘어날수록 `iptables` 규칙이 기하급수적으로 증가하며 성능 저하를 유발하죠.

이번 글에서는 **Kube-proxy를 완전히 제거하고**, eBPF 기반의 **Cilium**으로 이를 대체하는 방법(Kube-proxy Replacement)과, 왜 그렇게 해야 하는지 **성능 관점**에서 깊이 있게 다뤄보겠습니다.

---

## 1. Kube-proxy의 한계 (iptables의 고통)

Kube-proxy의 기본 모드인 `iptables` 모드는 리눅스 커널의 패킷 필터링 기능을 사용하여 서비스(ClusterIP) 트래픽을 백엔드 파드로 로드밸런싱합니다.

### O(N)의 복잡도
문제는 `iptables` 규칙이 리스트 형태(Sequential List)로 처리된다는 점입니다. 서비스 하나를 찾기 위해 수천, 수만 개의 규칙을 순차적으로 평가해야 할 수도 있습니다.
- 서비스 5,000개 생성 시: 라우팅 규칙 업데이트에 수 분 소요
- 패킷 처리량(Throughput) 저하 및 CPU 사용량 급증

`IPVS` 모드가 대안으로 나왔지만, 여전히 연결 추적(Conntrack) 테이블 고갈 문제나 복잡한 관리 포인트가 남습니다.

---

## 2. Cilium과 eBPF: 게임 체인저

Cilium은 리눅스 커널의 **eBPF(Extended Berkeley Packet Filter)** 기술을 활용합니다. 네트워크 패킷을 커널 레벨에서 샌드박싱된 프로그램으로 처리하죠.

### eBPF의 장점
1.  **O(1) 해시 테이블**: iptables의 순차 검색 대신, eBPF Map(해시 테이블)을 사용하여 어떤 규모에서도 **일정한(Constant)** 룩업 성능을 보장합니다.
2.  **Context Switching 감소**: 사용자 공간(User Space)과 커널 공간(Kernel Space) 사이의 불필요한 전환 없이 패킷을 즉시 처리합니다.
3.  **Kube-proxy 불필요**: Cilium이 Service IP 해석, 로드밸런싱, NAT를 모두 직접 수행합니다.

---

## 3. Kube-proxy Free 모드 구성하기

이제 실제로 Kube-proxy를 걷어내고 Cilium만으로 클러스터를 구성해 봅시다.

### 전제 조건
- EKS, GKE, 또는 베어메탈 클러스터 생성 시 `kube-proxy`를 애초에 설치하지 않거나, 설치 후 비활성화해야 합니다.
- (EKS의 경우) AWS VPC CNI와 체이닝하거나, Cilium을 전용 CNI로 쓸 수 있습니다.

### Helm 설정 (핵심)

Cilium 설치 시 `kubeProxyReplacement` 값을 `true`로 설정하는 것이 핵심입니다.

```bash
helm install cilium cilium/cilium \
  --namespace kube-system \
  --set kubeProxyReplacement=true \
  --set k8sServiceHost=API_SERVER_IP \
  --set k8sServicePort=API_SERVER_PORT \
  # 필요 시 추가 설정
  --set socketLB.enabled=true \
  --set bpf.masquerade=true
```

### 주요 파라미터 설명
- **`kubeProxyReplacement=true`**: Cilium이 kube-proxy 역할을 대신합니다.
- **`socketLB.enabled=true`**: 소켓 레벨 로드밸런싱을 활성화하여 사이드카 프록시를 거치지 않고도 파드 통신을 최적화합니다.
- **`bpf.masquerade=true`**: iptables 대신 eBPF 기반의 고성능 Masquerading(NAT)을 사용합니다.

---

## 4. 성능 차이 심층 분석

실제 벤치마크 결과(서비스 10,000개 기준)를 비교해보면 그 차이는 명확합니다.

### Latency (지연 시간)
- **Kube-proxy (iptables)**: 서비스 개수가 늘어날수록 Latency가 선형적으로 증가합니다. 특정 구간에서는 핑이 튀는 현상(Jitter)이 발생합니다.
- **Cilium (eBPF)**: 서비스가 100개든 10,000개든 Latency가 **거의 일정하게 유지**됩니다.

### CPU Overhead
- **Kube-proxy**: 룰 업데이트 시마다 커널 락(Lock)을 걸고 iptables 전체를 리로드하는 경우가 많아 CPU 스파이크가 발생합니다.
- **Cilium**: eBPF Map의 증분 업데이트(Incremental Update)만 수행하므로 CPU 부하가 매우 낮습니다.

### Throughput (처리량)
eBPF 기반의 XDP(eXpress Data Path)까지 활용하면, 네트워크 카드로 들어온 패킷을 OS 네트워크 스택을 거치지 않고 바로 처리할 수 있어, iptables 대비 **최대 5~6배** 이상의 처리량을 보여주기도 합니다.

---

## 5. 결론

대규모 클러스터나 마이크로서비스 아키텍처(MSA) 환경에서 **Kube-proxy Free (Cilium)** 모드는 선택이 아닌 필수 전락하고 있습니다.

단순히 "빠르다"는 것을 넘어, **운영의 복잡성을 줄이고 예측 가능한 성능**을 보장한다는 점에서 강력히 추천합니다. 지금 바로 여러분의 클러스터에서 레거시 iptables를 걷어내 보세요.

> **Note**: 기존 클러스터에서 마이그레이션할 경우, 다운타임이 발생할 수 있으므로 신중한 계획이 필요합니다.

---
