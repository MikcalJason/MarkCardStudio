import { ref } from "vue";
import {
  appendPublishRecord,
  readPublishHistory,
  removePublishRecord,
} from "../storage/publishHistory.js";

export function usePublishHistory() {
  const records = ref(readPublishHistory());

  function refresh() {
    records.value = readPublishHistory();
  }

  function append(record) {
    records.value = appendPublishRecord(record);
    return records.value[0] || null;
  }

  function remove(id) {
    records.value = removePublishRecord(id);
  }

  function findLast({ channelId = "", contentHash = "" } = {}) {
    return (
      records.value.find(
        (record) => record.channelId === channelId && record.contentHash === contentHash,
      ) || null
    );
  }

  return { append, findLast, records, refresh, remove };
}
