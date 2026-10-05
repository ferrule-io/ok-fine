{{/*
Expand the name of the chart.
*/}}
{{- define "ok-fine.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "ok-fine.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "ok-fine.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "ok-fine.labels" -}}
helm.sh/chart: {{ include "ok-fine.chart" . }}
{{ include "ok-fine.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "ok-fine.selectorLabels" -}}
app.kubernetes.io/name: {{ include "ok-fine.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "ok-fine.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "ok-fine.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Render image reference
*/}}
{{- define "ok-fine.image" -}}
{{- if .Values.image.digest }}
{{- printf "%s@%s" .Values.image.repository .Values.image.digest }}
{{- else }}
{{- printf "%s:%s" .Values.image.repository (.Values.image.tag | default .Chart.AppVersion) }}
{{- end }}
{{- end }}

{{/*
Render publicBaseUrl without trailing slash
*/}}
{{- define "ok-fine.publicBaseUrl" -}}
{{- required "config.publicBaseUrl is required" .Values.config.publicBaseUrl | trimSuffix "/" }}
{{- end }}

{{/*
Render public host from config.publicBaseUrl
*/}}
{{- define "ok-fine.host" -}}
{{- (urlParse (include "ok-fine.publicBaseUrl" .)).host -}}
{{- end }}

{{/*
Render data PVC name
*/}}
{{- define "ok-fine.dataClaimName" -}}
{{- if .Values.persistence.existingClaim }}
{{- .Values.persistence.existingClaim }}
{{- else }}
{{- printf "%s-data" (include "ok-fine.fullname" .) }}
{{- end }}
{{- end }}
