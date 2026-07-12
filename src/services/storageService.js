// Astrazione storage per file binari (PDF, foto): due driver intercambiabili.
//   - 'supabase' → Supabase Storage (produzione cloud)
//   - 'local'    → filesystem sotto STORAGE_DIR (sviluppo locale, come oggi)
// Il driver è scelto in config.storageDriver in base alla presenza di
// SUPABASE_URL + SUPABASE_SERVICE_KEY. La "key" è sempre un percorso relativo
// tipo 'output/2025-2026/report-12/000311_Rossi.pdf' o 'profiles/user-3-ab12cd34.jpg'.

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

let supabaseClient;

async function getSupabase() {
  if (!supabaseClient) {
    const { createClient } = await import('@supabase/supabase-js');
    supabaseClient = createClient(config.supabase.url, config.supabase.serviceKey, {
      auth: { persistSession: false }
    });
  }
  return supabaseClient;
}

function localPathForKey(key) {
  return path.join(config.storageDir, key);
}

export function isSupabaseStorage() {
  return config.storageDriver === 'supabase';
}

export async function putObject(key, buffer, contentType = 'application/octet-stream') {
  if (isSupabaseStorage()) {
    const supabase = await getSupabase();
    const { error } = await supabase.storage
      .from(config.supabase.bucket)
      .upload(key, buffer, { contentType, upsert: true });
    if (error) throw new Error(`Storage upload fallito (${key}): ${error.message}`);
    return key;
  }
  const filePath = localPathForKey(key);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buffer);
  return key;
}

export async function getObject(key) {
  if (isSupabaseStorage()) {
    const supabase = await getSupabase();
    const { data, error } = await supabase.storage.from(config.supabase.bucket).download(key);
    if (error) throw new Error(`Storage download fallito (${key}): ${error.message}`);
    return Buffer.from(await data.arrayBuffer());
  }
  return fs.readFileSync(localPathForKey(key));
}

export async function objectExists(key) {
  if (isSupabaseStorage()) {
    const supabase = await getSupabase();
    const dir = path.posix.dirname(key);
    const base = path.posix.basename(key);
    const { data, error } = await supabase.storage
      .from(config.supabase.bucket)
      .list(dir === '.' ? '' : dir, { search: base });
    if (error) return false;
    return (data || []).some((item) => item.name === base);
  }
  return fs.existsSync(localPathForKey(key));
}

export async function getSignedUrl(key, expiresInSeconds = 3600) {
  if (!isSupabaseStorage()) return null;
  const supabase = await getSupabase();
  const { data, error } = await supabase.storage
    .from(config.supabase.bucket)
    .createSignedUrl(key, expiresInSeconds);
  if (error) throw new Error(`Signed URL fallito (${key}): ${error.message}`);
  return data.signedUrl;
}

export async function removeObject(key) {
  if (isSupabaseStorage()) {
    const supabase = await getSupabase();
    await supabase.storage.from(config.supabase.bucket).remove([key]);
    return;
  }
  fs.rm(localPathForKey(key), { force: true }, () => {});
}
