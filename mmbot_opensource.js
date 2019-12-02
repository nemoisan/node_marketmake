const fs = require('fs');
const io = require('socket.io-client');
const socket = io("https://io.lightstream.bitflyer.com", { transports: ["websocket"] });
const util = require('./src/util')
const Logger = require('./src/logger')
const logger = new Logger("./log/");

let config = JSON.parse(fs.readFileSync('./config_mm.json', 'utf8'));
const ApiKey = config.apikey;
const ApiSecret = config.apisecret;
const AccountId = config.accountid;
const Cookie = config.cookie;

const Bitflyer = require('./bitflyer/bitflyerWebApi.js');

const api = new Bitflyer(ApiKey, ApiSecret, AccountId, Cookie);

const PRODUCT_CODE = config.product_code;
const channelName = "lightning_executions_" + PRODUCT_CODE;
let maxSize = config.max_size;
let size = config.size;
let sp = config.sp;
let haba1 = config.haba1;
let haba2 = config.haba2;
let time = config.time;
let exitOrder = config.exit_order;
let exitTotal = config.exit_total;
let orderServerStatus = config.server_status.split(",");
let resumeTime = config.resume_time;
let stopDelayTime = config.stop_delay_time;
let filterSpExit = config.filter_sp_exit;
let spExit = config.sp_exit;

let pos = 0;
let posExit = 0;
let ask = 0;
let bid = 0;
let tmp_ask = 0;
let tmp_bid = 0;
let orderTime = 0;
let closeOrderTime = 0;
let exitOrderTime = 0;
let serverResumeTime = 0;
let tmp_sellPrice = 0;
let tmp_buyPrice = 0;
let exeSize = 0;
let serverStatus = '';
let timeArr = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
let delayTime = 0;
let flagCloseOrder = 0;
let flagCheckPosition = 0;
let flagStop = 0;

socket.on("connect", () => {
    socket.emit("subscribe", channelName);
});
socket.on(channelName, message => {
    try { 
        exec(message);
    } catch (e) {
        console.log(e.message);
    }
});



function exec(message) {

    let len = message.length;
    let now = Date.now();
    timeArr.unshift(now - Date.parse(message[len - 1].exec_date));
    timeArr.pop();
    delayTime = Math.round(util.averageArr(timeArr));
    for (let i in message) {
        if (api.buyOrderIdArray.indexOf(message[i].buy_child_order_acceptance_id) >= 0) {
            exeSize += message[i].size;
            let delay = now - Date.parse(message[i].exec_date);
            logger.print(message[i].buy_child_order_acceptance_id + ' buy ' + message[i].size + ' at ' + message[i].price + ' pos: ' + Math.round(exeSize * 1e8) / 1e8 + ' delay: ' + delay + 'ms');
        }
        if (api.sellOrderIdArray.indexOf(message[i].sell_child_order_acceptance_id) >= 0) {
            exeSize -= message[i].size;
            let delay = now - Date.parse(message[i].exec_date);
            logger.print(message[i].sell_child_order_acceptance_id + ' sell ' + message[i].size + ' at ' + message[i].price + ' pos: ' + Math.round(exeSize * 1e8) / 1e8 + ' delay: ' + delay + 'ms');
        }
        if (flagCloseOrder == 1 && (api.marketOrderId == message[i].buy_child_order_acceptance_id || api.marketOrderId == message[i].sell_child_order_acceptance_id || api.marketOrderId == api.ERROR_MESSAGE || now > closeOrderTime + 30000)) {
            flagCloseOrder = 0;
            logger.debug('reset flag close')
        }
    } 
    if (now > orderTime && pos == 1 || now > exitOrderTime && posExit == 1) {
        api.cancelAll(PRODUCT_CODE);
        pos = 0;
        posExit = 0;
    }
    if (orderServerStatus.indexOf(serverStatus) >= 0 && now > serverResumeTime && delayTime < stopDelayTime) {
        if (message[len - 1].side == 'SELL') {
            for (let i = len - 1; i >= 0; i--) {
                if (message[i].side == 'BUY') {
                    ask = message[i].price;
                    break;
                }
            }
            tmp_bid = bid;
            bid = message[len - 1].price;
            spread = ask - bid;
            if (spread >= sp && ask != tmp_sellPrice && bid < tmp_bid) {
                if (exeSize > -0.01 || !exitOrder) {
                    if (exeSize >= 0.01 && exitTotal && pos == 0) {
                        api.sendLimitOrder('SELL', Math.round(exeSize * 1e8) / 1e8, Math.round(ask - spread * haba1 - haba2 - 1), 1, PRODUCT_CODE);
                    }
                    api.sendLimitOrder('SELL', setSellSize(), Math.round(ask - spread * haba1 - haba2), 1, PRODUCT_CODE);
                } else {
                    api.sendLimitOrder('SELL', setSellSize(), Math.round(ask - spread * haba1 - haba2), 1, PRODUCT_CODE);
                    if (!filterSpExit && pos == 0) {
                        api.sendLimitOrder('BUY', Math.round(-exeSize * 1e8) / 1e8, Math.round(bid + haba2), 1, PRODUCT_CODE);
                    }
                }
                orderTime = Date.now() + time;
                tmp_sellPrice = ask;
                pos = 1;
            }
        } else {
            for (let i = len - 1; i >= 0; i--) {
                if (message[i].side == "SELL") {
                    bid = message[i].price;
                    break;
                }
            }
            tmp_ask = ask;
            ask = message[len - 1].price;
            spread = ask - bid;
            if (spread > sp && bid != tmp_buyPrice && ask > tmp_ask) {
                if (exeSize < 0.01 || !exitOrder) {
                    if (exeSize <= -0.01 && exitTotal && pos == 0) {
                        api.sendLimitOrder('BUY', Math.round(-exeSize * 1e8) / 1e8, Math.round(bid + spread * haba1 + haba2 + 1), 1, PRODUCT_CODE);
                    }
                    api.sendLimitOrder('BUY', setBuySize(), Math.round(bid + spread * haba1 + haba2), 1, PRODUCT_CODE);
                } else {
                    api.sendLimitOrder('BUY', setBuySize(), Math.round(bid + spread * haba1 + haba2), 1, PRODUCT_CODE);
                    if (!filterSpExit && pos == 0) {
                        api.sendLimitOrder('SELL', Math.round(exeSize * 1e8) / 1e8, Math.round(ask - haba2), 1, PRODUCT_CODE);
                    }
                }
                
                orderTime = Date.now() + time;
                tmp_buyPrice = bid;
                pos = 1;
            }
        }

        if (filterSpExit && spread >= spExit && posExit == 0) {
            //console.log('exit');
            if (exeSize <= -0.01) {
                api.sendLimitOrder('BUY', Math.round(-exeSize * 1e8) / 1e8, Math.round(bid + haba2), 1, PRODUCT_CODE);
                posExit = 1;
            } else if (exeSize >= 0.01) {
                api.sendLimitOrder('SELL', Math.round(exeSize * 1e8) / 1e8, Math.round(ask - haba2), 1, PRODUCT_CODE);
                posExit = 1;
            }
            exitOrderTime = Date.now() + time;
        }
    }
    if (orderServerStatus.indexOf(serverStatus) < 0 || delayTime > stopDelayTime) {
        if (flagCloseOrder == 0 && flagCheckPosition == 0 && now > closeOrderTime + delayTime) {
            flagCheckPosition = 1;
            api.getPositions(PRODUCT_CODE, function (err, response, result_string) {
                const pos = JSON.parse(result_string);
                if (pos.length == 0) {
                    closeOrderTime = Date.now() + 5000;
                    exeSize = 0;
                    flagCheckPosition = 0;
                    logger.debug('no position pos:' + exeSize)
                    return;
                }

                let posSize = 0;
                //for (let i in pos) {
                    //posSize += pos[i] * (pos[i] == 'BUY' ? 1 : -1);
                    //posSize += pos[i].size * (pos[i].side == 'BUY' ? 1 : -1);
                //}
                if (posSize >= 0.01) {
                    api.sendMarketOrder('SELL', Math.round(posSize * 1e8) / 1e8, PRODUCT_CODE);
                    exeSize = 0;
                    closeOrderTime = Date.now();
                    flagCloseOrder = 1;
                    logger.print('order sell close all server status: ' + serverStatus + ' delay: ' + delayTime + 'ms');
                } else if (posSize <= -0.01) {
                    api.sendMarketOrder('BUY', Math.round(-posSize * 1e8) / 1e8, PRODUCT_CODE);
                    exeSize = 0;
                    closeOrderTime = Date.now();
                    flagCloseOrder = 1;
                    logger.print('order buy close all server status: ' + serverStatus + ' delay: ' + delayTime + 'ms');
                }
                flagCheckPosition = 0;
            })
            let args = {
                'product_code': 'FX_BTC_JPY',
                'child_order_state': 'ACTIVE'
            }
            api.getOrders(args, function (err, response, result_string){
                const orders = JSON.parse(result_string);
                if (orders.length == 0) {
                    return;
                } else {
                    api.cancelAll(PRODUCT_CODE);
                }
            })

        }
        flagStop = 1;
        console.log('server status: ' + serverStatus + ' delay: ' + delayTime + 'ms');
    } else if (flagStop == 1){
        serverResumeTime = Date.now() + resumeTime;
        flagStop = 0;
        console.log('resume')
    }
}

function setBuySize() {
    if (maxSize - exeSize < size) {
        return Math.round((maxSize - exeSize) * 1e8) / 1e8;
    } else if (exeSize > 0) {
        return size;
    } else {
        if (exitTotal) {
            return size;
        } else {
            if (exeSize > -size) {
                return Math.round((size - exeSize) * 1e8) / 1e8;
            } else {
                return size * 2;                
            }
        }
    }
}

function setSellSize() {
    if (maxSize + exeSize < size) {
        return Math.round((maxSize + exeSize) * 1e8) / 1e8;
    } else if (exeSize < 0) {
        return size;
    } else {
        if (exitTotal) {
            return size;
        } else {
            if (exeSize < size) {
                return Math.round((size + exeSize) * 1e8) / 1e8;  
            } else {
                return size * 2;                
            }
        }
    }
}

function resetConfig() {
    config = JSON.parse(fs.readFileSync('./config_mm.json', 'utf8'));
    maxSize = config.max_size;
    size = config.size;
    sp = config.sp;
    haba1 = config.haba1;
    haba2 = config.haba2;
    time = config.time;
    exitOrder = config.exit_order;
    exitTotal = config.exit_total;
    orderServerStatus = config.server_status.split(",");
    resumeTime = config.resume_time;
    stopDelayTime = config.stop_delay_time;
    filterSpExit = config.filter_sp_exit;
    spExit = config.sp_exit;
}

setInterval(function () {
    api.getBoardState(PRODUCT_CODE, function (err, response, result_string) {
        serverStatus = JSON.parse(result_string).health;
    });
    resetConfig();
}, 2000);