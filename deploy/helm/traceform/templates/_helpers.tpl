{{/*
Expand the name of the chart.
*/}}
{{- define "agentstack.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
*/}}
{{- define "agentstack.fullname" -}}
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
{{- define "agentstack.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "agentstack.labels" -}}
helm.sh/chart: {{ include "agentstack.chart" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: agentstack
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}

{{/*
Selector labels for a specific component.
Usage: {{ include "agentstack.selectorLabels" (dict "root" . "component" "server") }}
*/}}
{{- define "agentstack.selectorLabels" -}}
app.kubernetes.io/name: {{ include "agentstack.name" .root }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{/*
Component labels (common + selector).
Usage: {{ include "agentstack.componentLabels" (dict "root" . "component" "server") }}
*/}}
{{- define "agentstack.componentLabels" -}}
{{ include "agentstack.labels" .root }}
{{ include "agentstack.selectorLabels" (dict "root" .root "component" .component) }}
{{- end }}

{{/*
Create the name of the service account to use.
*/}}
{{- define "agentstack.serviceAccountName" -}}
{{- default (include "agentstack.fullname" .) .Values.serviceAccount.name }}
{{- end }}

{{/*
Build the image reference with optional global registry.
Usage: {{ include "agentstack.image" (dict "root" . "image" .Values.server.image) }}
*/}}
{{- define "agentstack.image" -}}
{{- $registry := .root.Values.global.imageRegistry -}}
{{- $repository := .image.repository -}}
{{- $tag := .image.tag | default "latest" -}}
{{- if $registry -}}
{{- printf "%s/%s:%s" $registry $repository $tag -}}
{{- else -}}
{{- printf "%s:%s" $repository $tag -}}
{{- end -}}
{{- end }}

{{/*
Secrets name helper.
*/}}
{{- define "agentstack.secretName" -}}
{{ include "agentstack.fullname" . }}-secrets
{{- end }}

{{/*
ConfigMap name helper.
*/}}
{{- define "agentstack.configMapName" -}}
{{ include "agentstack.fullname" . }}-config
{{- end }}

{{/*
Database URL construction.
*/}}
{{- define "agentstack.databaseURL" -}}
postgresql://{{ .Values.postgresql.username }}:$(DB_PASSWORD)@{{ .Values.postgresql.host }}:{{ .Values.postgresql.port }}/{{ .Values.postgresql.database }}?sslmode=disable
{{- end }}

{{/*
ClickHouse URL construction.
*/}}
{{- define "agentstack.clickhouseURL" -}}
clickhouse://{{ .Values.clickhouse.host }}:{{ .Values.clickhouse.port }}/{{ .Values.clickhouse.database }}
{{- end }}

{{/*
Redis URL construction.
*/}}
{{- define "agentstack.redisURL" -}}
redis://{{ .Values.redis.host }}:{{ .Values.redis.port }}
{{- end }}

{{/*
NATS URL construction.
*/}}
{{- define "agentstack.natsURL" -}}
nats://{{ .Values.nats.host }}:{{ .Values.nats.port }}
{{- end }}

{{/*
Image pull secrets.
*/}}
{{- define "agentstack.imagePullSecrets" -}}
{{- if .Values.global.imagePullSecrets }}
imagePullSecrets:
{{- range .Values.global.imagePullSecrets }}
  - name: {{ . }}
{{- end }}
{{- end }}
{{- end }}
