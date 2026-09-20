param(
  [string]$NasHost = "192.168.1.200",
  [string]$NasUser = "tkh",
  [int]$SshPort = 1150,
  [string]$RemoteRoot = "/volume1/docker/workhub",
  [string]$PublicUrl = "https://workhub.nasgfe1.synology.me"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Invoke-External {
  param(
    [Parameter(Mandatory = $true)][string]$Program,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )

  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Program failed with exit code $LASTEXITCODE"
  }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Push-Location $repoRoot

try {
  $dirty = git status --porcelain
  if ($LASTEXITCODE -ne 0) { throw "Unable to read Git status" }
  if ($dirty) { throw "Working tree must be clean before NAS deployment" }

  $commit = (git rev-parse --short=12 HEAD).Trim()
  if ($LASTEXITCODE -ne 0) { throw "Unable to resolve Git commit" }
  $releaseId = "$(Get-Date -Format 'yyyyMMdd-HHmmss')-$commit"
  $archive = Join-Path ([System.IO.Path]::GetTempPath()) "workhub-$releaseId.tar.gz"
  $remoteScriptLocal = Join-Path ([System.IO.Path]::GetTempPath()) "workhub-deploy-$releaseId.sh"
  $remoteArchive = "$RemoteRoot/releases/workhub-$releaseId.tar.gz"
  $remoteScript = "$RemoteRoot/releases/deploy-$releaseId.sh"
  $target = "$NasUser@$NasHost"

  Write-Host "[1/5] Building verified release $releaseId"
  Invoke-External npm @("run", "verify")
  Invoke-External git @("archive", "--format=tar.gz", "-o", $archive, "HEAD")

  Write-Host "[2/5] Checking NAS and persistent configuration"
  $preflight = @"
set -eu
test -d '$RemoteRoot/app'
test -f '$RemoteRoot/app/.env.nas'
test -f '$RemoteRoot/app/workhub-line.env'
test -f '$RemoteRoot/secrets/workhub-receipt-ai.env'
mkdir -p '$RemoteRoot/releases' '$RemoteRoot/backups'
"@
  Invoke-External ssh @("-p", "$SshPort", "-o", "ConnectTimeout=10", $target, $preflight)

  Write-Host "[3/5] Uploading release archive"
  # Synology DSM may disable the SFTP subsystem used by modern scp.
  # Force the legacy SCP protocol, which works over the same secured SSH session.
  Invoke-External scp @("-O", "-P", "$SshPort", $archive, "${target}:$remoteArchive")

  Write-Host "[4/5] Backing up and rebuilding WorkHub"
  $remoteDeploy = @"
set -eu
# Synology Container Manager keeps its CLI outside sudo's restricted PATH.
export PATH="/var/packages/ContainerManager/target/usr/bin:`$PATH"
ROOT='$RemoteRoot'
RID='$releaseId'
STAGE="`$ROOT/app.__staging_`$RID"
PREVIOUS="`$ROOT/app.__previous_`$RID"
BACKUP="`$ROOT/backups/`$RID"
ARCHIVE='$remoteArchive'

cleanup_stage() { rm -rf "`$STAGE"; }
trap cleanup_stage EXIT
mkdir -p "`$STAGE" "`$BACKUP"
tar -xzf "`$ARCHIVE" -C "`$STAGE"
cp -p "`$ROOT/app/.env.nas" "`$STAGE/.env.nas"
cp -p "`$ROOT/app/workhub-line.env" "`$STAGE/workhub-line.env"
cp -p "`$ROOT/app/.env.nas" "`$BACKUP/.env.nas"
cp -p "`$ROOT/app/workhub-line.env" "`$BACKUP/workhub-line.env"

if docker info >/dev/null 2>&1; then
  DOCKER='docker'
elif sudo -n docker info >/dev/null 2>&1; then
  DOCKER='sudo -n docker'
else
  echo 'Docker access is unavailable for this SSH account.' >&2
  exit 21
fi

if `$DOCKER compose version >/dev/null 2>&1; then
  COMPOSE="`$DOCKER compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE='docker-compose'
else
  echo 'Docker Compose is unavailable.' >&2
  exit 22
fi

cd "`$STAGE"
`$COMPOSE -p workhub -f compose.synology.yaml config -q
mv "`$ROOT/app" "`$PREVIOUS"
mv "`$STAGE" "`$ROOT/app"
trap - EXIT

rollback() {
  echo 'Deployment failed; restoring previous source.' >&2
  cd "`$ROOT"
  mv "`$ROOT/app" "`$ROOT/app.__failed_`$RID"
  mv "`$PREVIOUS" "`$ROOT/app"
  cd "`$ROOT/app"
  `$COMPOSE -p workhub -f compose.synology.yaml up -d --build
}

cd "`$ROOT/app"
if ! `$COMPOSE -p workhub -f compose.synology.yaml up -d --build; then
  rollback
  exit 23
fi

healthy=0
for attempt in 1 2 3 4 5 6 7 8 9 10 11 12; do
  if curl -fsS http://127.0.0.1:8080/api/health >/dev/null; then
    healthy=1
    break
  fi
  sleep 5
done

if [ "`$healthy" -ne 1 ]; then
  rollback
  exit 24
fi

tar -czf "`$BACKUP/source.tar.gz" -C "`$PREVIOUS" .
rm -rf "`$PREVIOUS"
echo '$commit' > "`$ROOT/app/DEPLOYED_COMMIT"
rm -f '$remoteScript'
echo "Release `$RID is healthy"
"@
  Set-Content -LiteralPath $remoteScriptLocal -Value $remoteDeploy -NoNewline
  Invoke-External scp @("-O", "-P", "$SshPort", $remoteScriptLocal, "${target}:$remoteScript")
  Invoke-External ssh @("-tt", "-p", "$SshPort", $target, "sudo -S sh '$remoteScript'")

  Write-Host "[5/5] Verifying LAN and public HTTPS"
  Invoke-External curl @("-fsS", "http://${NasHost}:8080/api/health")
  Invoke-External curl @("-fsS", "${PublicUrl}/api/health")
  Write-Host "Deployment completed: $releaseId"
}
finally {
  Pop-Location
  if ($archive -and (Test-Path $archive)) {
    Remove-Item -LiteralPath $archive -Force
  }
  if ($remoteScriptLocal -and (Test-Path $remoteScriptLocal)) {
    Remove-Item -LiteralPath $remoteScriptLocal -Force
  }
}
