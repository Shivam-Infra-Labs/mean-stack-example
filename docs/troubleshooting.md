# MEAN Stack Troubleshooting Guide

This document covers common issues that may occur while building, running and deploying the MEAN Stack application with Docker Compose, Kind, Kubernetes, Prometheus and Grafana.

## 1. Docker Compose Issues

### 1.1 A container is not starting

Check service status:

```bash
docker compose ps
```

Inspect logs:

```bash
docker compose logs -f
```

Inspect a specific service:

```bash
docker compose logs -f client
docker compose logs -f server
docker compose logs -f database
```

Look for image build failures, missing environment variables, database connection errors and port conflicts.

### 1.2 Frontend is not opening on port 8080

Check whether the client container is running:

```bash
docker compose ps client
```

Inspect frontend logs:

```bash
docker compose logs client
```

Check whether another process is using port 8080:

```bash
sudo ss -lntp | grep ':8080'
```

If the port is already in use, stop the conflicting process or change the host port mapping in `docker-compose.yml`.

### 1.3 Backend cannot connect to MongoDB

Check both services:

```bash
docker compose ps
docker compose logs database
docker compose logs server
```

Inside the Compose network, the backend should connect using the service hostname:

```text
database:27017
```

Do not use `localhost:27017` from inside the backend container to reach the database container.

The current Compose configuration uses the `database` service name and does not enable MongoDB authentication by default.

### 1.4 MongoDB data appears to be missing

Check the named volume:

```bash
docker volume ls
```

Inspect Compose services and volumes:

```bash
docker compose config
docker compose ps
```

The project uses the named volume `mongo-data`.

Be careful with:

```bash
docker compose down -v
```

That command removes the Compose-managed volume and can delete the database data.

## 2. Docker Image Build Issues

### 2.1 Docker build fails

Build each image separately to isolate the failing component:

```bash
docker build -t mean-stack-example-client:latest ./client
```

```bash
docker build -t mean-stack-example-server:latest ./server
```

Review the first meaningful error in the build output.

Common causes include:

- Incorrect Dockerfile paths.
- Missing files in the build context.
- Dependency installation failures.
- TypeScript or Angular build errors.
- Incorrect `.dockerignore` rules.

### 2.2 Updated code is not visible in Kubernetes

Building an image on the host does not automatically update an image already loaded into Kind.

Rebuild and reload the image:

```bash
docker build -t mean-stack-example-server:latest ./server

kind load docker-image mean-stack-example-server:latest --name mean-cluster
```

Restart the Deployment:

```bash
kubectl rollout restart deployment/server -n mean-app
```

Check the rollout:

```bash
kubectl rollout status deployment/server -n mean-app
```

Repeat the same process for the frontend if its code changed.

## 3. Kind Cluster Issues

### 3.1 No Kind cluster found

Check:

```bash
kind get clusters
```

Create the cluster if it does not exist:

```bash
kind create cluster --name mean-cluster --config k8s/kind-config.yaml
```

### 3.2 kubectl has no current context

Check:

```bash
kubectl config get-contexts
kubectl config current-context
```

For this cluster, select:

```bash
kubectl config use-context kind-mean-cluster
```

Then verify:

```bash
kubectl cluster-info
kubectl get nodes
```

### 3.3 Images cannot be found by Kubernetes

Check local images:

```bash
docker images | grep mean-stack-example
```

Load them into Kind:

```bash
kind load docker-image mean-stack-example-client:latest --name mean-cluster

kind load docker-image mean-stack-example-server:latest --name mean-cluster
```

Check the Deployment image and pull policy:

```bash
kubectl describe deployment client -n mean-app
kubectl describe deployment server -n mean-app
```

The project currently uses local image names with `imagePullPolicy: IfNotPresent`.

## 4. Kubernetes Pod Issues

### 4.1 Pod is stuck in Pending

Check:

```bash
kubectl get pods -n mean-app -o wide
kubectl describe pod <POD_NAME> -n mean-app
kubectl get events -n mean-app --sort-by=.metadata.creationTimestamp
```

Possible causes:

- PVC is not bound.
- Insufficient cluster resources.
- Invalid resource configuration.
- Scheduling constraints.

Check storage:

```bash
kubectl get pvc -n mean-app
kubectl get pv
```

### 4.2 Pod is in ImagePullBackOff or ErrImagePull

Check the exact image name:

```bash
kubectl describe deployment client -n mean-app
kubectl describe deployment server -n mean-app
```

Check images loaded into Kind and load them again if required.

### 4.3 Pod is in CrashLoopBackOff

Inspect logs:

```bash
kubectl logs <POD_NAME> -n mean-app
```

If the container has restarted, inspect the previous container logs:

```bash
kubectl logs <POD_NAME> -n mean-app --previous
```

Inspect events:

```bash
kubectl describe pod <POD_NAME> -n mean-app
```

Look for missing Secret keys, invalid database URIs, database connection errors and application startup failures.

## 5. MongoDB and Secret Issues

### 5.1 Missing Secret or missing Secret key

Check whether the Secret exists without displaying its values:

```bash
kubectl get secret mean-mongo-credentials -n mean-app
```

Inspect the key names only:

```bash
kubectl get secret mean-mongo-credentials -n mean-app \
  -o jsonpath='{.data}' | jq 'keys'
```

The database Deployment expects:

- `MONGO_INITDB_ROOT_USERNAME`
- `MONGO_INITDB_ROOT_PASSWORD`

The backend Deployment expects:

- `DATABASE_URI`

A Secret created with different key names will not satisfy those references.

### 5.2 Correct the Secret key names

If the Secret is missing or has incorrect keys, recreate/apply it with the correct names:

```bash
kubectl create secret generic mean-mongo-credentials \
  --namespace mean-app \
  --from-literal=MONGO_INITDB_ROOT_USERNAME=root \
  --from-literal=MONGO_INITDB_ROOT_PASSWORD='<YOUR_STRONG_PASSWORD>' \
  --from-literal=DATABASE_URI='mongodb://root:<YOUR_STRONG_PASSWORD>@database:27017/meanStackExample?authSource=admin' \
  --dry-run=client -o yaml | kubectl apply -f -
```

Replace both password placeholders with the same actual password. Do not include the angle brackets.

Restart the relevant Deployments if they need to reread changed environment variables:

```bash
kubectl rollout restart deployment/database -n mean-app
kubectl rollout restart deployment/server -n mean-app
```

**Important:** Updating a Secret does not automatically change environment variables inside already-running containers. A restart is needed for environment-variable consumers.

### 5.3 MongoDB authentication fails

Check database logs:

```bash
kubectl logs deployment/database -n mean-app
```

Check backend logs:

```bash
kubectl logs deployment/server -n mean-app
```

Verify that:

- The username is correct.
- The password is correct.
- The `DATABASE_URI` uses the same credentials.
- The URI includes `authSource=admin`.
- MongoDB initialization completed successfully.

The MongoDB container's initialization variables create the root user when the data directory is initialized for the first time. If a PVC already contains initialized database files, changing initialization variables does not necessarily create or update that user.

Do not delete the PVC as a quick fix. That can destroy persistent database data. First inspect the existing database state and decide how to safely update credentials.

## 6. Frontend and Backend Connectivity

### 6.1 Frontend loads but API requests fail

Check the frontend NGINX configuration:

```bash
cat client/nginx.conf
```

The project uses `/api/` as the frontend API path and proxies it to:

```text
http://server:5300/
```

Because of the trailing slash in `proxy_pass`, `/api/employees` is forwarded as `/employees`.

Check the backend:

```bash
kubectl get pods -n mean-app
kubectl get svc -n mean-app
kubectl get endpoints -n mean-app
kubectl logs deployment/server -n mean-app
```

Make sure the backend Service has endpoints and the frontend can resolve the backend Service name.

### 6.2 Backend health check fails

The backend Kubernetes probes use:

```text
/healthcheck
```

Inspect backend logs:

```bash
kubectl logs deployment/server -n mean-app
```

Check the Deployment probe configuration:

```bash
kubectl describe deployment server -n mean-app
```

The backend starts after its database connection is established in the current application flow. A database connection problem can therefore prevent the health endpoint from becoming available.

## 7. Kubernetes Service and Networking Issues

### 7.1 Application does not open at port 8081

Check:

```bash
kubectl get svc -n mean-app
kubectl get pods -n mean-app
kubectl get endpoints -n mean-app
```

The frontend Service should expose NodePort `30080`.

Check the Kind configuration:

```bash
cat k8s/kind-config.yaml
```

It should map container port `30080` to host port `8081` on `127.0.0.1`.

### 7.2 Service has no endpoints

Check the Service and Pod labels:

```bash
kubectl describe svc client -n mean-app
kubectl get pods -n mean-app --show-labels
```

A Service selector must match the labels on the Pods it should route traffic to.

## 8. Persistent Volume Issues

### 8.1 PVC remains Pending

Check:

```bash
kubectl get pvc -n mean-app
kubectl describe pvc mongo-data-pvc -n mean-app
kubectl get storageclass
```

A PVC needs a compatible storage provisioner or available persistent volume.

The exact behavior depends on the storage configuration of the Kind cluster.

### 8.2 Database data is not retained

Check that the MongoDB Deployment mounts `mongo-data-pvc` at `/data/db`.

```bash
kubectl describe deployment database -n mean-app
kubectl get pvc -n mean-app
```

A PVC is persistent storage, but data retention also depends on the underlying PV and its reclaim policy.

Keep separate backups of important data.

## 9. Prometheus Troubleshooting

### 9.1 Prometheus target is DOWN

Port-forward Prometheus:

```bash
kubectl port-forward svc/prometheus 9090:9090 -n monitoring
```

Open:

```text
http://localhost:9090/targets
```

Inspect the target error.

Check monitoring resources:

```bash
kubectl get pods -n monitoring
kubectl get svc -n monitoring
kubectl logs deployment/prometheus -n monitoring
```

Check the backend:

```bash
kubectl get pods -n mean-app
kubectl get svc -n mean-app
kubectl logs deployment/server -n mean-app
```

The intended backend target is:

```text
server.mean-app.svc.cluster.local:5300/metrics
```

A target can fail if:

- The backend Pod is not ready.
- The backend Service has no endpoints.
- The metrics endpoint is not implemented or enabled.
- The Prometheus scrape configuration has an incorrect target.
- Prometheus cannot reach the backend Service.

### 9.2 Prometheus is not scraping metrics

Inspect the actual configuration:

```bash
cat k8s/monitoring/prometheus-config.yaml
```

Confirm that the scrape job, target hostname, port and metrics path match the backend implementation.

A configured target does not prove that the backend exports valid metrics. Verify the endpoint and inspect the Prometheus target error.

## 10. Grafana Troubleshooting

### 10.1 Grafana page is not opening

Run:

```bash
kubectl get pods -n monitoring
kubectl get svc grafana -n monitoring
kubectl logs deployment/grafana -n monitoring
```

Start port forwarding:

```bash
kubectl port-forward svc/grafana 3000:3000 -n monitoring
```

Open:

```text
http://localhost:3000
```

Keep the port-forward terminal running.

### 10.2 Grafana dashboard shows no data

Check:

1. Prometheus is running.
2. Prometheus targets are healthy.
3. Grafana has a working Prometheus data source.
4. The selected dashboard queries match available metric names.
5. The dashboard time range includes data.

A running Grafana Pod alone does not prove that the data source and dashboards are configured correctly.

## 11. General Diagnostic Commands

Use these commands to collect a quick status overview.

```bash
kind get clusters

kubectl get nodes

kubectl get pods -n mean-app -o wide

kubectl get svc -n mean-app

kubectl get pvc -n mean-app

kubectl get pods -n monitoring -o wide

kubectl get svc -n monitoring

kubectl get events -A --sort-by=.metadata.creationTimestamp
```

For a particular Pod:

```bash
kubectl describe pod <POD_NAME> -n <NAMESPACE>
```

For logs:

```bash
kubectl logs <POD_NAME> -n <NAMESPACE>
```

For previous container logs:

```bash
kubectl logs <POD_NAME> -n <NAMESPACE> --previous
```

## 12. Safe Troubleshooting Practices

- Inspect logs and events before deleting resources.
- Do not delete a PVC without checking whether its data is needed.
- Do not expose Secret values in screenshots or public issue reports.
- Avoid committing passwords or database URIs.
- Rebuild and reload Kind images when application code changes.
- Check Service endpoints when Pods are running but traffic fails.
- Confirm Prometheus target health rather than assuming monitoring works because the Pod is running.
- Keep backups before database upgrades or destructive cleanup.

When reporting an issue, include the command output, relevant Pod events and sanitized logs. Remove passwords, tokens and private connection strings first.