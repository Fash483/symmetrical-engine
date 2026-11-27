// Kaggle script -> Colab script: Colab paths, hardcoded credential placeholders (unless the txt method is
// chosen) and a LOCAL_DIR that may contain * ? [ (matches the first existing folder, e.g. /content/Shared*).
// Drive is already mounted in Colab, so nothing is imported or mounted.
export const CF_DEFAULT = "/content/drive/MyDrive/";

export function toColab(code, dir) {
  const d = dir || CF_DEFAULT;
  return code
    .replace(/^# FULL RUN, no split/m, "# COLAB RUN")
    .replace('CREDS_FILE = "/kaggle/working/', 'CREDS_FILE = "/content/')
    .replace('LOCAL_DIR = "/kaggle/working/"', () => "LOCAL_DIR = " + JSON.stringify(d))
    .replace(/from kaggle_secrets import UserSecretsClient\n+(?:s = UserSecretsClient\(\)\n)?((?:[A-Z0-9_]+ = (?:s|UserSecretsClient\(\))\.get_secret\("[A-Za-z0-9_]+"\)\n?)+)/,
      (m, g) => g.replace(/= (?:s|UserSecretsClient\(\))\.get_secret\("([A-Za-z0-9_]+)"\)/g, (x, n) => '= "<your_' + n.toLowerCase() + '>"'))
    .replace("\ndef target(", () => '\nLOCAL_DIR = resolve_dir(LOCAL_DIR).rstrip("/") + "/"  # * ? [ match the first existing folder\n\ndef target(');
}

// saved "save to" folders: normalise what was typed
export function normCfDir(v) {
  let d = String(v || "").trim().replace(/\\/g, "/");
  if (!d) return "";
  if (!d.startsWith("/")) d = "/content/" + d;
  return d.endsWith("/") ? d : d + "/";
}
