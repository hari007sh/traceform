# AgentStack Helm Chart

Kubernetes Helm chart for deploying the AgentStack platform -- the open-source AI agent production platform.

## Prerequisites

- Kubernetes 1.25+
- Helm 3.10+
- PostgreSQL 16+ (external or in-cluster)
- ClickHouse (external or in-cluster)
- Redis 7+ (external or in-cluster)
- NATS (external or in-cluster)
- cert-manager (optional, for automatic TLS)
- nginx-ingress-controller (optional, for Ingress)

## Quick Start

### 1. Add the database credentials secret

Create the secret that holds your PostgreSQL password before installing the chart:

```bash
kubectl create secret generic agentstack-db-credentials \
  --from-literal=password=YOUR_DB_PASSWORD
```

### 2. Create a values override file

```bash
cat > my-values.yaml <<EOF
secrets:
  jwtSecret: "your-secure-jwt-secret-at-least-32-chars"
  encryptionKey: "your-32-byte-hex-encryption-key"
  githubClientId: "your-github-oauth-client-id"
  githubClientSecret: "your-github-oauth-client-secret"

ingress:
  hosts:
    - host: agentstack.example.com
      paths:
        - path: /
          pathType: Prefix
          service: web
        - path: /v1
          pathType: Prefix
          service: server
        - path: /api
          pathType: Prefix
          service: server
        - path: /auth
          pathType: Prefix
          service: server
        - path: /docs
          pathType: Prefix
          service: server
        - path: /health
          pathType: Prefix
          service: server
        - path: /metrics
          pathType: Prefix
          service: server
  tls:
    - secretName: agentstack-tls
      hosts:
        - agentstack.example.com

postgresql:
  host: your-postgres-host.svc.cluster.local
  port: 5432
  database: agentstack
  username: agentstack
  existingSecret: agentstack-db-credentials
  secretKey: password

clickhouse:
  host: your-clickhouse-host.svc.cluster.local
  port: 9000
  database: agentstack

redis:
  host: your-redis-host.svc.cluster.local
  port: 6379

nats:
  host: your-nats-host.svc.cluster.local
  port: 4222
EOF
```

### 3. Install the chart

```bash
helm install agentstack ./deploy/helm/agentstack -f my-values.yaml
```

### 4. Verify the deployment

```bash
kubectl get pods -l app.kubernetes.io/part-of=agentstack
kubectl get ingress
```

## Upgrading

```bash
helm upgrade agentstack ./deploy/helm/agentstack -f my-values.yaml
```

The migration Job runs automatically as a Helm pre-install/pre-upgrade hook, so database schema changes are applied before new pods roll out.

## Values Reference

### Global

| Key | Description | Default |
|-----|-------------|---------|
| `global.imageRegistry` | Global Docker image registry prefix | `""` |
| `global.imagePullSecrets` | List of image pull secret names | `[]` |

### Server (API Server, port 8080)

| Key | Description | Default |
|-----|-------------|---------|
| `server.image.repository` | Server image repository | `agentstack/server` |
| `server.image.tag` | Server image tag | `latest` |
| `server.image.pullPolicy` | Image pull policy | `IfNotPresent` |
| `server.replicas` | Number of replicas (ignored when HPA enabled) | `2` |
| `server.resources.requests.cpu` | CPU request | `250m` |
| `server.resources.requests.memory` | Memory request | `512Mi` |
| `server.resources.limits.cpu` | CPU limit | `1000m` |
| `server.resources.limits.memory` | Memory limit | `1Gi` |
| `server.service.type` | Kubernetes Service type | `ClusterIP` |
| `server.service.port` | Service port | `8080` |
| `server.env.ENVIRONMENT` | Runtime environment name | `production` |

### Gateway (LLM Proxy, port 8090)

| Key | Description | Default |
|-----|-------------|---------|
| `gateway.image.repository` | Gateway image repository | `agentstack/gateway` |
| `gateway.image.tag` | Gateway image tag | `latest` |
| `gateway.replicas` | Number of replicas (ignored when HPA enabled) | `2` |
| `gateway.resources.requests.cpu` | CPU request | `250m` |
| `gateway.resources.requests.memory` | Memory request | `512Mi` |
| `gateway.resources.limits.cpu` | CPU limit | `1000m` |
| `gateway.resources.limits.memory` | Memory limit | `1Gi` |
| `gateway.service.type` | Kubernetes Service type | `ClusterIP` |
| `gateway.service.port` | Service port | `8090` |

### Worker (Background Workers)

| Key | Description | Default |
|-----|-------------|---------|
| `worker.image.repository` | Worker image repository | `agentstack/worker` |
| `worker.image.tag` | Worker image tag | `latest` |
| `worker.replicas` | Number of replicas | `1` |
| `worker.resources.requests.cpu` | CPU request | `500m` |
| `worker.resources.requests.memory` | Memory request | `1Gi` |
| `worker.resources.limits.cpu` | CPU limit | `2000m` |
| `worker.resources.limits.memory` | Memory limit | `2Gi` |

### Web (Next.js Dashboard, port 3000)

| Key | Description | Default |
|-----|-------------|---------|
| `web.image.repository` | Web image repository | `agentstack/web` |
| `web.image.tag` | Web image tag | `latest` |
| `web.replicas` | Number of replicas | `2` |
| `web.resources.requests.cpu` | CPU request | `100m` |
| `web.resources.requests.memory` | Memory request | `256Mi` |
| `web.resources.limits.cpu` | CPU limit | `500m` |
| `web.resources.limits.memory` | Memory limit | `512Mi` |
| `web.service.type` | Kubernetes Service type | `ClusterIP` |
| `web.service.port` | Service port | `3000` |

### Migration Job

| Key | Description | Default |
|-----|-------------|---------|
| `migrate.image.repository` | Migration image (same as server) | `agentstack/server` |
| `migrate.image.tag` | Migration image tag | `latest` |
| `migrate.backoffLimit` | Number of retries before marking failed | `3` |
| `migrate.ttlSecondsAfterFinished` | Cleanup completed Job after N seconds | `300` |

### Ingress

| Key | Description | Default |
|-----|-------------|---------|
| `ingress.enabled` | Enable Ingress resource | `true` |
| `ingress.className` | Ingress class name | `nginx` |
| `ingress.annotations` | Ingress annotations | cert-manager issuer |
| `ingress.hosts` | List of host rules with path routing | see values.yaml |
| `ingress.tls` | TLS configuration | see values.yaml |

### Autoscaling (HPA)

| Key | Description | Default |
|-----|-------------|---------|
| `autoscaling.enabled` | Enable HPA for server and gateway | `true` |
| `autoscaling.minReplicas` | Minimum replica count | `2` |
| `autoscaling.maxReplicas` | Maximum replica count | `10` |
| `autoscaling.targetCPUUtilizationPercentage` | CPU threshold for scaling | `70` |
| `autoscaling.targetMemoryUtilizationPercentage` | Memory threshold for scaling | `80` |

### External Dependencies

#### PostgreSQL

| Key | Description | Default |
|-----|-------------|---------|
| `postgresql.external` | Use an external PostgreSQL instance | `true` |
| `postgresql.host` | PostgreSQL hostname | `postgresql.default.svc.cluster.local` |
| `postgresql.port` | PostgreSQL port | `5432` |
| `postgresql.database` | Database name | `agentstack` |
| `postgresql.username` | Database username | `agentstack` |
| `postgresql.existingSecret` | K8s Secret holding the DB password | `agentstack-db-credentials` |
| `postgresql.secretKey` | Key within the secret | `password` |

#### ClickHouse

| Key | Description | Default |
|-----|-------------|---------|
| `clickhouse.external` | Use an external ClickHouse instance | `true` |
| `clickhouse.host` | ClickHouse hostname | `clickhouse.default.svc.cluster.local` |
| `clickhouse.port` | ClickHouse native port | `9000` |
| `clickhouse.database` | Database name | `agentstack` |

#### Redis

| Key | Description | Default |
|-----|-------------|---------|
| `redis.external` | Use an external Redis instance | `true` |
| `redis.host` | Redis hostname | `redis-master.default.svc.cluster.local` |
| `redis.port` | Redis port | `6379` |

#### NATS

| Key | Description | Default |
|-----|-------------|---------|
| `nats.external` | Use an external NATS instance | `true` |
| `nats.host` | NATS hostname | `nats.default.svc.cluster.local` |
| `nats.port` | NATS port | `4222` |

### Secrets

| Key | Description | Default |
|-----|-------------|---------|
| `secrets.jwtSecret` | JWT signing secret (required) | `""` |
| `secrets.encryptionKey` | AES-256-GCM encryption key for provider API keys | `""` |
| `secrets.githubClientId` | GitHub OAuth application client ID | `""` |
| `secrets.githubClientSecret` | GitHub OAuth application client secret | `""` |

## Configuring External Databases

AgentStack expects four infrastructure dependencies to be available. You can deploy them however you like (managed cloud services, Helm sub-charts, or bare operators) and then point AgentStack at them via values.

### Using Bitnami sub-charts (example)

Install PostgreSQL, Redis, and NATS via their Bitnami Helm charts, then set the hosts:

```bash
# Install PostgreSQL
helm install postgresql oci://registry-1.docker.io/bitnamicharts/postgresql \
  --set auth.username=agentstack \
  --set auth.password=changeme \
  --set auth.database=agentstack

# Install Redis
helm install redis oci://registry-1.docker.io/bitnamicharts/redis \
  --set auth.enabled=false

# Install NATS
helm install nats oci://registry-1.docker.io/bitnamicharts/nats

# Install ClickHouse (use Altinity operator or clickhouse-operator)
# Then configure values accordingly
```

Then in your values override:

```yaml
postgresql:
  host: postgresql.default.svc.cluster.local
  existingSecret: postgresql   # Bitnami creates this automatically
  secretKey: postgres-password

redis:
  host: redis-master.default.svc.cluster.local

nats:
  host: nats.default.svc.cluster.local
```

### Using managed cloud services (AWS/GCP/Azure)

Point the hosts at your managed service endpoints:

```yaml
postgresql:
  host: agentstack-db.abc123.us-east-1.rds.amazonaws.com
  port: 5432
  existingSecret: agentstack-rds-credentials
  secretKey: password

clickhouse:
  host: agentstack-ch.abc123.clickhouse.cloud
  port: 9440

redis:
  host: agentstack-cache.abc123.cache.amazonaws.com
  port: 6379
```

## Setting Up TLS with cert-manager

### 1. Install cert-manager

```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.14.0/cert-manager.yaml
```

### 2. Create a ClusterIssuer for Let's Encrypt

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: admin@yourdomain.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
      - http01:
          ingress:
            class: nginx
```

```bash
kubectl apply -f cluster-issuer.yaml
```

### 3. Configure the chart

The default values already include the cert-manager annotation. Just set your hostname:

```yaml
ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
  hosts:
    - host: agentstack.yourdomain.com
      paths:
        - path: /
          pathType: Prefix
          service: web
        - path: /v1
          pathType: Prefix
          service: server
        - path: /api
          pathType: Prefix
          service: server
        - path: /auth
          pathType: Prefix
          service: server
        - path: /docs
          pathType: Prefix
          service: server
        - path: /health
          pathType: Prefix
          service: server
        - path: /metrics
          pathType: Prefix
          service: server
  tls:
    - secretName: agentstack-tls
      hosts:
        - agentstack.yourdomain.com
```

cert-manager will automatically provision and renew the TLS certificate.

## Uninstalling

```bash
helm uninstall agentstack
```

Note: PersistentVolumeClaims and Secrets created outside of Helm (like `agentstack-db-credentials`) are not removed automatically.
