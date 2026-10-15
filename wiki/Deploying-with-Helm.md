The chart runs a single replica with a `Recreate` strategy and a `ReadWriteOnce` PVC (kept on uninstall), as a
non-root user with a read-only root filesystem. Installing from `charts/ok-fine` in a repository checkout also works.

```sh
helm install okf oci://ghcr.io/ferrule-io/charts/ok-fine --version <version> \
  --namespace okf --create-namespace \
  --set config.publicBaseUrl=https://okf.example.com \
  --set oauth.issuer=https://idp.example.com/realms/okf \
  --set ingress.enabled=true --set ingress.className=nginx \
  --set ingress.annotations."cert-manager\.io/cluster-issuer"=letsencrypt-prod \
  --set ingress.tls.secretName=okf-tls
```

When `config.publicBaseUrl` starts with `https://`, ingress requires `ingress.tls.secretName` unless TLS is terminated upstream (set `ingress.tls.terminatedUpstream=true` when TLS is terminated by an external load balancer or edge proxy).

The default image `ghcr.io/ferrule-io/ok-fine` is multi-arch (`linux/amd64`, `linux/arm64`), tagged `<version>`, `latest`, `sha-<short>`. Build your own with `docker build -t <registry>/ok-fine:<tag> .`
and set `image.repository` / `image.tag` (or `image.digest`).

Sync to a git remote over SSH requires a `known_hosts` entry in the secret (strict host key checking is enforced; ok-fine does not trust host keys on first use):

```sh
kubectl -n okf create secret generic okf-git \
  --from-file=ssh-privatekey=./deploy_key \
  --from-file=known_hosts=./known_hosts

helm upgrade okf oci://ghcr.io/ferrule-io/charts/ok-fine --reuse-values \
  --set git.remote.url=git@github.com:acme/knowledge.git \
  --set git.remote.auth=ssh \
  --set git.remote.existingSecret=okf-git
```

For HTTPS, use `git.remote.auth=https` and a Secret with `username` and `password` keys (e.g. a fine-grained token).
## Deploying with API keys (`auth.mode=api_key`)

To use static API keys instead of an external OIDC provider, create a Kubernetes Secret containing the `API_KEYS` string:

```sh
kubectl -n okf create secret generic ok-fine-api-keys \
  --from-literal=API_KEYS='ci:read:c988a8d1160d5b4a45e7f12e8738a9bc6f6983a9394602f928e4695ce09b917d,deploy:admin:1e976694e97a3a8301140939d84f88eef0ff268571cb1a18290f9b6b7a0d18f8'
```

Then deploy with `auth.mode=api_key` and reference the Secret in `apiKeys.existingSecret`:

```yaml
config:
  publicBaseUrl: https://okf.example.com

auth:
  mode: api_key

apiKeys:
  existingSecret: ok-fine-api-keys
  secretKey: API_KEYS       # default: API_KEYS
  header: x-api-key         # optional custom header, default: x-api-key

ingress:
  enabled: true
  className: nginx
  tls:
    secretName: okf-tls
```

The chart injects `API_KEYS` via `secretKeyRef` and does not require `oauth.issuer`. Template rendering will fail if `auth.mode` is `api_key` and `apiKeys.existingSecret` is not provided.


Other notable values:

- `auth.mode`: `oidc` (default), `api_key`, or `none`. Use `api_key` for pre-shared static keys from `apiKeys.existingSecret` without an external IdP. Use `none` only for local testing where authentication is skipped; because `none` grants every caller full admin access, ingress and httpRoute must be disabled (the chart fails validation if either is enabled with `auth.mode=none`), and access must be via `kubectl -n okf port-forward svc/okf 8080:8080`. The chart automatically sets `ALLOW_UNAUTHENTICATED_NETWORK=true` when `auth.mode=none`.
- `apiKeys.existingSecret`: name of a pre-created Secret containing `API_KEYS` (REQUIRED when `auth.mode=api_key`; optional in `oidc` mode).
- `apiKeys.secretKey`: key within `existingSecret` holding the `API_KEYS` string (default: `API_KEYS`).
- `apiKeys.header`: optional custom request header for API keys (default: `x-api-key`).
- `config.trustProxy`: configure Fastify proxy trust (e.g. `"loopback,linklocal,uniquelocal"`, a boolean, or hop count; passed as `TRUST_PROXY`).
- `oauth.allowedSubjects`: list of allowed JWT `sub` claims.
- `oauth.allowedEmails`: list of allowed verified email addresses (case-insensitive).
- `oauth.requiredGroups`: list of required user groups.
- `oauth.groupsClaim`: claim name containing user groups (default: `"groups"`).
- `oauth.allowedClientIds`: list of allowed OAuth client IDs (`azp`, `client_id`, or `cid`).
- `oauth.audiences`: list of accepted audience strings.
- `oauth.jwksUri`: override the discovered JWKS URI.
- `persistence.*`
- `ingress.*` / `httpRoute.*` (Gateway API)
- `networkPolicy.*`
- `oauth.uiClientId`: public client for the [web UI](https://github.com/ferrule-io/ok-fine/wiki/Authentication-and-Authorization#web-ui); empty = dynamic client registration
- `extraEnv`

See [`values.yaml`](https://github.com/ferrule-io/ok-fine/blob/main/charts/ok-fine/values.yaml) for the full list. `helm test okf` checks `/healthz`.
