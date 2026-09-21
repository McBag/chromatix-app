import { list, get } from '@vercel/blob';

export const TAGS_BLOB_PATHNAME = 'tags.json';

export interface TagsWithEtag {
  tags: string[];
  etag: string | null;
}

/**
 * Reads the current tags array from blob storage, along with its ETag for
 * use with `ifMatch` on a subsequent conditional write. Returns an empty
 * array and a null ETag if the blob does not exist yet.
 */
export async function readTagsWithEtag(): Promise<TagsWithEtag> {
  const { blobs } = await list({ prefix: TAGS_BLOB_PATHNAME });
  const existing = blobs.find((blob) => blob.pathname === TAGS_BLOB_PATHNAME);

  if (!existing) {
    return { tags: [], etag: null };
  }

  try {
    const blob = await get(existing.url, { access: 'private', useCache: false });
    const data = await new Response(blob?.stream).json();

    if (!Array.isArray(data) || data.some((tag) => typeof tag !== 'string')) {
      throw new Error('Stored tags are not an array of strings');
    }

    return { tags: data, etag: existing.etag };
  } catch (error) {
    if (error instanceof Error && error.message === 'Stored tags are not an array of strings') {
      throw error;
    }
    throw new Error('Failed to read tags', { cause: error });
  }
}

/**
 * Reads the current tags array from blob storage, or returns an empty array
 * if the blob does not exist yet.
 */
export async function readTags(): Promise<string[]> {
  const { tags } = await readTagsWithEtag();
  return tags;
}
