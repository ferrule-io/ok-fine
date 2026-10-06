The chart runs a single replica with a `Recreate` strategy and a `ReadWriteOnce` PVC (kept on uninstall), as a
non-root user with a read-only root filesystem. Installing from `charts/ok-fine` in a repository checkout also works.

```sh
helm install okf oci://ghcr.io/ferrule-io/charts/ok-fine --version <version> \
  --namespace okf --create-namespace \
  --set config.publicBaseUrl=https://okf.example.com \
  --set oauth.issuer=https://idp.example.com/realms/okf \
  --set ingress.enabled=true --set ingress.className=nginx
```

The default image `ghcr.io/ferrule-io/ok-fine` is multi-arch (`linux/amd64`, `linux/arm64`), tagged `<version>`, `latest`, `sha-<short>`. Build your own with `docker build -t <registry>/ok-fine:<tag> .`
and set `image.repository` / `image.tag` (or `image.digest`).

Sync to a git remote over SSH:

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

Other notable values:

- `auth.mode`: `oidc` (default) or `none`. Use `none` for throwaway or local clusters where authentication is skipped; `oauth.issuer` is not required when `auth.mode=none`.
- `persistence.*`
- `ingress.*` / `httpRoute.*` (Gateway API)
- `networkPolicy.*`
- `oauth.audiences`
- `oauth.jwksUri`
- `oauth.uiClientId`: public client for the [web UI](https://github.com/ferrule-io/ok-fine/wiki/Authentication-and-Authorization#web-ui); empty = dynamic client registration
- `extraEnv`

See [`values.yaml`](https://github.com/ferrule-io/ok-fine/blob/main/charts/ok-fine/values.yaml) for the full list. `helm test okf` checks `/healthz`.
