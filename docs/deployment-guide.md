# MEAN Stack Deployment Guide

This guide explains how to deploy the Employee Records application using Docker Compose and Kubernetes on a local Kind cluster.

It also covers Prometheus and Grafana access.

## 1. Prerequisites

Install and verify the following tools:

- Docker Engine.
- Docker Compose plugin.
- kubectl.
- Kind.
- Git.
- Node.js and npm if you also want to run the application directly outside containers.

Check versions:

```bash
docker --version
docker compose version
kubectl version --client
kind version
git --version
```

Run the commands from the repository root:

```bash
cd ~/Projects/mean-stack-example
```

## 2. Option A — Deploy with Docker Compose

Docker Compose is the simplest way to start the application locally.

### 2.1 Validate the Compose configuration

```bash
docker compose config
```

If this command reports an error, fix the Compose YAML before starting the services.

### 2.2 Build and start the application

```bash
docker compose up --build -d
```

### 2.3 Check running containers

```bash
docker compose ps
```

View logs:

```bash
docker compose logs -f
```

View one service's logs:

```bash
docker compose logs -f client
docker compose logs -f server
docker compose logs -f database
```

### 2.4 Open the application

```text
http://localhost:8080
```

### 2.5 Stop the application

```bash
docker compose down
```

The named MongoDB volume is retained by default.

To remove the containers and the named volume as well:

```bash
docker compose down -v
```

**Warning:** `docker compose down -v` deletes the Compose-managed database volume and its data. Do not run it if you need to preserve your database.

## 3. Option B — Deploy to Kubernetes using Kind

This section follows the local deployment workflow used for this project.

### 3.1 Build the frontend and backend images

From the repository root:

```bash
docker build -t mean-stack-example-client:latest ./client

docker build -t mean-stack-example-server:latest ./server
```

Verify the images:

```bash
docker images | grep mean-stack-example
```

### 3.2 Create the Kind cluster

```bash
kind create cluster --name mean-cluster --config k8s/kind-config.yaml
```

Check the cluster:

```bash
kind get clusters
kubectl cluster-info
kubectl get nodes
```

### 3.3 Load the local images into Kind

Kind nodes use their own container runtime. Loading the images makes the locally built images available to the cluster.

```bash
kind load docker-image mean-stack-example-client:latest --name mean-cluster

kind load docker-image mean-stack-example-server:latest --name mean-cluster
```

The application Deployments use `imagePullPolicy: IfNotPresent`, so Kubernetes can use the images loaded into the Kind node instead of trying to pull them from a remote registry.

### 3.4 Create the application namespace

```bash
kubectl apply -f k8s/namespace.yaml
```

Verify:

```bash
kubectl get namespace mean-app
```

### 3.5 Create the MongoDB Secret

The application manifests expect the Secret named `mean-mongo-credentials`.

**Important:** The keys must match the names referenced by `k8s/app/database.yaml` and `k8s/app/server.yaml`.

Use a strong password and replace the placeholder consistently:

```bash
kubectl create secret generic mean-mongo-credentials \
  --namespace mean-app \
  --from-literal=MONGO_INITDB_ROOT_USERNAME=root \
  --from-literal=MONGO_INITDB_ROOT_PASSWORD='<YOUR_STRONG_PASSWORD>' \
  --from-literal=DATABASE_URI='mongodb://root:<YOUR_STRONG_PASSWORD>@database:27017/meanStackExample?authSource=admin' \
  --dry-run=client -o yaml | kubectl apply -f -
```

Replace both password placeholders with the same actual password. Do not include the angle brackets.

The `DATABASE_URI` must use the same username and password as the MongoDB initialization credentials.

Avoid putting real credentials in source files, screenshots, shell scripts or Git commits. Be aware that commands entered directly in a shell can remain in shell history.

Verify the Secret exists without printing its values:

```bash
kubectl get secret mean-mongo-credentials -n mean-app
```

### 3.6 Apply the application manifests

```bash
kubectl apply -f k8s/app/
```

Check the resources:

```bash
kubectl get all -n mean-app
```

Check the PVC:

```bash
kubectl get pvc -n mean-app
```

### 3.7 Check Pod status

```bash
kubectl get pods -n mean-app -o wide
```

Wait for the Deployments:

```bash
kubectl rollout status deployment/client -n mean-app
kubectl rollout status deployment/server -n mean-app
kubectl rollout status deployment/database -n mean-app
```

If a Pod is not ready, inspect its logs and events before proceeding:

```bash
kubectl describe pods -n mean-app
kubectl logs deployment/database -n mean-app
kubectl logs deployment/server -n mean-app
kubectl logs deployment/client -n mean-app
```

### 3.8 Open the Kubernetes application

The Kind configuration maps host port `8081` to NodePort `30080`.

Open:

```text
http://127.0.0.1:8081
```

If the page does not load, check the Kind cluster, frontend Pod and Service:

```bash
kind get clusters
kubectl get pods -n mean-app
kubectl get svc -n mean-app
kubectl get endpoints -n mean-app
```

## 4. Deploy Prometheus and Grafana

The project keeps monitoring resources in a separate namespace.

### 4.1 Create the monitoring namespace

```bash
kubectl apply -f k8s/monitoring/namespace.yaml
```

Verify:

```bash
kubectl get namespace monitoring
```

### 4.2 Apply the monitoring manifests

```bash
kubectl apply -f k8s/monitoring/
```

Check monitoring resources:

```bash
kubectl get all -n monitoring
```

Check Pods:

```bash
kubectl get pods -n monitoring -o wide
```

If a monitoring Pod is not ready:

```bash
kubectl describe pods -n monitoring
kubectl logs deployment/prometheus -n monitoring
kubectl logs deployment/grafana -n monitoring
```

The exact Deployment names should match the manifests in the repository.

### 4.3 Access Grafana

Run:

```bash
kubectl port-forward svc/grafana 3000:3000 -n monitoring
```

Keep this terminal open.

Open another browser tab:

```text
http://localhost:3000
```

The login credentials depend on the Grafana configuration in the repository. Do not assume default credentials if the deployment has been customized. Check the relevant manifest or provisioning configuration.

### 4.4 Access Prometheus

Open a separate terminal and run:

```bash
kubectl port-forward svc/prometheus 9090:9090 -n monitoring
```

Keep the terminal open.

Open:

```text
http://localhost:9090/targets
```

Inspect the configured scrape targets and their status.

The intended backend target is:

```text
server.mean-app.svc.cluster.local:5300/metrics
```

A target is expected to become healthy only if the backend exposes the metrics endpoint and Prometheus can reach it.

## 5. Useful Kubernetes Commands

### Application resources

```bash
kubectl get all -n mean-app
kubectl get pods -n mean-app -o wide
kubectl get svc -n mean-app
kubectl get pvc -n mean-app
kubectl get configmap -n mean-app
kubectl get secrets -n mean-app
```

### Monitoring resources

```bash
kubectl get all -n monitoring
kubectl get pods -n monitoring -o wide
kubectl get svc -n monitoring
```

### Logs

```bash
kubectl logs deployment/client -n mean-app
kubectl logs deployment/server -n mean-app
kubectl logs deployment/database -n mean-app
```

Follow logs:

```bash
kubectl logs -f deployment/server -n mean-app
```

### Describe resources

```bash
kubectl describe deployment server -n mean-app
kubectl describe pod -n mean-app
kubectl describe svc client -n mean-app
```

### Rollout status

```bash
kubectl rollout status deployment/client -n mean-app
kubectl rollout status deployment/server -n mean-app
kubectl rollout status deployment/database -n mean-app
```

### Restart an application Deployment

```bash
kubectl rollout restart deployment/server -n mean-app
```

A restart does not rebuild an image. If you changed source code, rebuild the image, load it into Kind and restart or update the Deployment.

## 6. Rebuild and Update Local Kubernetes Images

When application source code changes:

```bash
docker build -t mean-stack-example-client:latest ./client

docker build -t mean-stack-example-server:latest ./server
```

Load the updated images:

```bash
kind load docker-image mean-stack-example-client:latest --name mean-cluster

kind load docker-image mean-stack-example-server:latest --name mean-cluster
```

Restart the Deployments:

```bash
kubectl rollout restart deployment/client -n mean-app

kubectl rollout restart deployment/server -n mean-app
```

Wait for the rollout:

```bash
kubectl rollout status deployment/client -n mean-app

kubectl rollout status deployment/server -n mean-app
```

For a more reproducible workflow, use versioned image tags instead of relying only on `latest`.

## 7. Cleanup

### Delete the application resources

```bash
kubectl delete -f k8s/app/
kubectl delete -f k8s/namespace.yaml
```

Deleting the namespace removes its namespaced resources, including its Secret and PVC object. Depending on the storage provisioner and reclaim policy, the underlying persistent volume may have different deletion behavior. Verify storage resources before cleanup if data matters.

### Delete the monitoring resources

```bash
kubectl delete -f k8s/monitoring/
```

### Delete the Kind cluster

```bash
kind delete cluster --name mean-cluster
```

Deleting the Kind cluster removes the local cluster and its in-cluster resources. Do not use this as a substitute for a database backup.

## 8. Important Notes

- Run commands from the repository root unless the command says otherwise.
- The Kubernetes Secret keys must match the keys referenced by the manifests.
- The MongoDB username and password in `DATABASE_URI` must match the MongoDB initialization credentials.
- Existing MongoDB data in a PVC may prevent initialization environment variables from creating a new user. Do not delete a PVC to troubleshoot without first considering data loss.
- The current MongoDB image is `mongo:4.4`; plan a supported-version migration before production use.
- Prometheus and Grafana access commands require the port-forward process to remain running.
- A successful `kubectl apply` means resources were accepted by the API server; it does not guarantee that Pods became healthy.
- Check Pod status, events, logs, Service endpoints and Prometheus targets to validate the deployment.