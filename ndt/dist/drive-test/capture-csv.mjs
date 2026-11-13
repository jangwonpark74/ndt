export const CSV_COLUMNS=['timestamp','latitude','longitude','rat','band','pci','arfcn','cell_id',
 'rsrp_dbm','rsrq_db','sinr_db','dl_mbps','ul_mbps','latency_ms','predicted_rx_dbm','measured_rx_dbm','measurement_status','event'];
function cell(value){
 if(value==null)return '';
 if(typeof value!=='string')return String(value);
 const text=/^[=+@\-\t\r]/.test(value)?"'"+value:value;
 return '"'+text.replaceAll('"','""')+'"';
}
export const captureCSV=rows=>[CSV_COLUMNS.join(','),...rows.map(row=>CSV_COLUMNS.map(k=>cell(k==='timestamp'?new Date(row.t).toISOString():row[k])).join(','))].join('\r\n')+'\r\n';
export const captureTemplate=()=>captureCSV([{t:Date.parse('2026-11-09T14:10:00Z'),latitude:43.64036,longitude:-79.39472,rat:'NR',band:'n78',pci:412,arfcn:640128,cell_id:'N-412',rsrp_dbm:-91.2,rsrq_db:-10.4,sinr_db:18.3,dl_mbps:125.1,ul_mbps:20.2,latency_ms:21}]);
