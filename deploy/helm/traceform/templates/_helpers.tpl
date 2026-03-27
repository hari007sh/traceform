{{/*
Expand the name of the chart.
*/}}
{{- define "traceform.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
*/}}
{{- define "traceform.fullname" -}}
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
{{- define "traceform.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "traceform.labels" -}}
helm.sh/chart: {{ include "traceform.chart" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: agentstack
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}

{{/*
Selector labels for a specific component.
Usage: {{ include "traceform.selectorLabels" (dict "root" . "component" "server") }}
*/}}
{{- define "traceform.selectorLabels" -}}
app.kubernetes.io/name: {{ include "traceform.name" .root }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{/*
Component labels (common + selector).
Usage: {{ include "traceform.componentLabels" (dict "root" . "component" "server") }}
*/}}
{{- define "traceform.componentLabels" -}}
{{ include "traceform.labels" .root }}
{{ include "traceform.selectorLabels" (dict "root" .root "component" .component) }}
{{- end }}

{{/*
Create the name of the service account to use.
*/}}
{{- define "traceform.serviceAccountName" -}}
{{- default (include "traceform.fullname" .) .Values.serviceAccount.name }}
{{- end }}

{{/*
Build the image reference with optional global registry.
Usage: {{ include "traceform.image" (dict "root" . "image" .Values.server.image) }}
*/}}
{{- define "traceform.image" -}}
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
{{- define "traceform.secretName" -}}
{{ include "traceform.fullname" . }}-secrets
{{- end }}

{{/*
ConfigMap name helper.
*/}}
{{- define "traceform.configMapName" -}}
{{ include "traceform.fullname" . }}-config
{{- end }}

{{/*
Database URL construction.
*/}}
{{- define "traceform.databaseURL" -}}
postgresql://{{ .Values.postgresql.username }}:$(DB_PASSWORD)@{{ .Values.postgresql.host }}:{{ .Values.postgresql.port }}/{{ .Values.postgresql.database }}?sslmode=disable
{{- end }}

{{/*
ClickHouse URL construction.
*/}}
{{- define "traceform.clickhouseURL" -}}
clickhouse://{{ .Values.clickhouse.host }}:{{ .Values.clickhouse.port }}/{{ .Values.clickhouse.database }}
{{- end }}

{{/*
Redis URL construction.
*/}}
{{- define "traceform.redisURL" -}}
redis://{{ .Values.redis.host }}:{{ .Values.redis.port }}
{{- end }}

{{/*
NATS URL construction.
*/}}
{{- define "traceform.natsURL" -}}
nats://{{ .Values.nats.host }}:{{ .Values.nats.port }}
{{- end }}

{{/*
Image pull secrets.
*/}}
{{- define "traceform.imagePullSecrets" -}}
{{- if .Values.global.imagePullSecrets }}
imagePullSecrets:
{{- range .Values.global.imagePullSecrets }}
  - name: {{ . }}
{{- end }}
{{- end }}
{{- end }}
