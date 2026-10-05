//+------------------------------------------------------------------+
//|                                            RiskDesk_Bridge.mq5   |
//|  Mengirim info akun, posisi terbuka & pending order ke RiskDesk. |
//|  EA ini TIDAK membuka, mengubah, atau menutup posisi apa pun.    |
//+------------------------------------------------------------------+
#property copyright   "RiskDesk"
#property version     "2.10"
#property description "Kirim posisi terbuka dan pending order MT5 ke RiskDesk secara berkala (hanya membaca, tidak trading)."

input string SupabaseUrl     = "https://xxxx.supabase.co"; // Project URL Supabase
input string AnonKey         = "";                         // Anon / publishable key
input string SyncToken       = "";                         // SyncToken dari RiskDesk → Pengaturan → Cloud & MT5
input int    IntervalSeconds = 10;                         // Jeda pengiriman (detik, minimal 5)

uint   g_lastPush = 0;
string g_status   = "";

//+------------------------------------------------------------------+
int OnInit()
  {
   if(StringLen(SupabaseUrl) < 12 || StringFind(SupabaseUrl, "xxxx") >= 0 || StringLen(AnonKey) < 20 || StringLen(SyncToken) < 16)
     {
      Alert("RiskDesk Bridge: isi SupabaseUrl, AnonKey, dan SyncToken di tab Inputs.");
      return(INIT_PARAMETERS_INCORRECT);
     }
   EventSetTimer(MathMax(5, IntervalSeconds));
   Push();
   return(INIT_SUCCEEDED);
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   Comment("");
  }

void OnTimer() { Push(); }

// Kirim segera saat ada perubahan posisi (dibatasi maksimal 1x per 2 detik)
void OnTrade()
  {
   if(GetTickCount() - g_lastPush > 2000)
      Push();
  }

//+------------------------------------------------------------------+
string Esc(string s)
  {
   StringReplace(s, "\\", "\\\\");
   StringReplace(s, "\"", "\\\"");
   return(s);
  }

string Num(double v, int digits = 8)
  {
   if(!MathIsValidNumber(v)) return("null");
   return(DoubleToString(v, digits));
  }

string BaseUrl()
  {
   string u = SupabaseUrl;
   StringTrimRight(u);
   StringTrimLeft(u);
   while(StringLen(u) > 0 && StringSubstr(u, StringLen(u) - 1, 1) == "/")
      u = StringSubstr(u, 0, StringLen(u) - 1);
   return(u);
  }

//+------------------------------------------------------------------+
string PendingName(long t)
  {
   switch((int)t)
     {
      case ORDER_TYPE_BUY_LIMIT:       return("buy_limit");
      case ORDER_TYPE_SELL_LIMIT:      return("sell_limit");
      case ORDER_TYPE_BUY_STOP:        return("buy_stop");
      case ORDER_TYPE_SELL_STOP:       return("sell_stop");
      case ORDER_TYPE_BUY_STOP_LIMIT:  return("buy_stop_limit");
      case ORDER_TYPE_SELL_STOP_LIMIT: return("sell_stop_limit");
     }
   return("");
  }

bool IsBuyType(long t)
  {
   return(t == ORDER_TYPE_BUY_LIMIT || t == ORDER_TYPE_BUY_STOP || t == ORDER_TYPE_BUY_STOP_LIMIT);
  }

// Pending order (limit / stop) ditambahkan ke array yang sama dengan "kind":"pending"
void AppendPending(string &out, int &count, int &pend)
  {
   int total = OrdersTotal();
   for(int i = 0; i < total; i++)
     {
      ulong ticket = OrderGetTicket(i);
      if(ticket == 0) continue;
      long   otype = OrderGetInteger(ORDER_TYPE);
      string name  = PendingName(otype);
      if(name == "") continue; // abaikan order market yang sedang diproses

      string sym   = OrderGetString(ORDER_SYMBOL);
      double vol   = OrderGetDouble(ORDER_VOLUME_CURRENT);
      double price = OrderGetDouble(ORDER_PRICE_OPEN);
      double slim  = OrderGetDouble(ORDER_PRICE_STOPLIMIT);
      double sl    = OrderGetDouble(ORDER_SL);
      double tp    = OrderGetDouble(ORDER_TP);
      double cur   = OrderGetDouble(ORDER_PRICE_CURRENT);
      long   setup = OrderGetInteger(ORDER_TIME_SETUP);
      long   expir = OrderGetInteger(ORDER_TIME_EXPIRATION);
      int    dg    = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
      bool   buy   = IsBuyType(otype);
      // Untuk Stop Limit, harga eksekusi adalah harga limit-nya
      double fill  = (slim > 0 && (otype == ORDER_TYPE_BUY_STOP_LIMIT || otype == ORDER_TYPE_SELL_STOP_LIMIT)) ? slim : price;

      ENUM_ORDER_TYPE ot = buy ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
      string lossAtSl = "null", profitAtTp = "null";
      double val = 0;
      if(sl > 0 && OrderCalcProfit(ot, sym, vol, fill, sl, val)) lossAtSl = Num(val, 2);
      if(tp > 0 && OrderCalcProfit(ot, sym, vol, fill, tp, val)) profitAtTp = Num(val, 2);

      if(count > 0) out += ",";
      out += "{";
      out += "\"kind\":\"pending\",";
      out += "\"ticket\":" + IntegerToString((long)ticket) + ",";
      out += "\"symbol\":\"" + Esc(sym) + "\",";
      out += "\"type\":\"" + (buy ? "buy" : "sell") + "\",";
      out += "\"order_type\":\"" + name + "\",";
      out += "\"volume\":" + Num(vol, 2) + ",";
      out += "\"price_open\":" + Num(fill, dg) + ",";
      out += "\"price_trigger\":" + Num(price, dg) + ",";
      out += "\"sl\":" + Num(sl, dg) + ",";
      out += "\"tp\":" + Num(tp, dg) + ",";
      out += "\"price_current\":" + Num(cur, dg) + ",";
      out += "\"profit\":0,\"swap\":0,";
      out += "\"loss_at_sl\":" + lossAtSl + ",";
      out += "\"profit_at_tp\":" + profitAtTp + ",";
      out += "\"time\":" + IntegerToString(setup) + ",";
      out += "\"expiration\":" + IntegerToString(expir);
      out += "}";
      count++;
      pend++;
     }
  }

//+------------------------------------------------------------------+
string BuildPositions(int &count, int &pend)
  {
   string out = "[";
   count = 0;
   pend = 0;
   int total = PositionsTotal();
   for(int i = 0; i < total; i++)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;

      string sym    = PositionGetString(POSITION_SYMBOL);
      long   type   = PositionGetInteger(POSITION_TYPE);
      double vol    = PositionGetDouble(POSITION_VOLUME);
      double open   = PositionGetDouble(POSITION_PRICE_OPEN);
      double sl     = PositionGetDouble(POSITION_SL);
      double tp     = PositionGetDouble(POSITION_TP);
      double cur    = PositionGetDouble(POSITION_PRICE_CURRENT);
      double profit = PositionGetDouble(POSITION_PROFIT);
      double swap   = PositionGetDouble(POSITION_SWAP);
      long   opened = PositionGetInteger(POSITION_TIME);
      int    dg     = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);

      ENUM_ORDER_TYPE ot = (type == POSITION_TYPE_BUY) ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;

      // Hitung rugi/untung di SL/TP langsung oleh MT5 (akurat sesuai spesifikasi broker)
      string lossAtSl = "null", profitAtTp = "null";
      double val = 0;
      if(sl > 0 && OrderCalcProfit(ot, sym, vol, open, sl, val)) lossAtSl = Num(val, 2);
      if(tp > 0 && OrderCalcProfit(ot, sym, vol, open, tp, val)) profitAtTp = Num(val, 2);

      if(count > 0) out += ",";
      out += "{";
      out += "\"kind\":\"open\",";
      out += "\"ticket\":" + IntegerToString((long)ticket) + ",";
      out += "\"symbol\":\"" + Esc(sym) + "\",";
      out += "\"type\":\"" + (type == POSITION_TYPE_BUY ? "buy" : "sell") + "\",";
      out += "\"volume\":" + Num(vol, 2) + ",";
      out += "\"price_open\":" + Num(open, dg) + ",";
      out += "\"sl\":" + Num(sl, dg) + ",";
      out += "\"tp\":" + Num(tp, dg) + ",";
      out += "\"price_current\":" + Num(cur, dg) + ",";
      out += "\"profit\":" + Num(profit, 2) + ",";
      out += "\"swap\":" + Num(swap, 2) + ",";
      out += "\"loss_at_sl\":" + lossAtSl + ",";
      out += "\"profit_at_tp\":" + profitAtTp + ",";
      out += "\"time\":" + IntegerToString(opened);
      out += "}";
      count++;
     }
   AppendPending(out, count, pend);
   out += "]";
   return(out);
  }

string BuildAccount()
  {
   string a = "{";
   a += "\"login\":\"" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "\",";
   a += "\"server\":\"" + Esc(AccountInfoString(ACCOUNT_SERVER)) + "\",";
   a += "\"currency\":\"" + Esc(AccountInfoString(ACCOUNT_CURRENCY)) + "\",";
   a += "\"leverage\":" + IntegerToString(AccountInfoInteger(ACCOUNT_LEVERAGE)) + ",";
   a += "\"balance\":" + Num(AccountInfoDouble(ACCOUNT_BALANCE), 2) + ",";
   a += "\"equity\":" + Num(AccountInfoDouble(ACCOUNT_EQUITY), 2) + ",";
   a += "\"margin\":" + Num(AccountInfoDouble(ACCOUNT_MARGIN), 2) + ",";
   a += "\"margin_free\":" + Num(AccountInfoDouble(ACCOUNT_MARGIN_FREE), 2);
   a += "}";
   return(a);
  }

//+------------------------------------------------------------------+
void Push()
  {
   g_lastPush = GetTickCount();
   int n = 0, pend = 0;
   string body = "{\"p_token\":\"" + Esc(SyncToken) + "\",\"p_account\":" + BuildAccount() + ",\"p_positions\":" + BuildPositions(n, pend) + "}";

   char data[];
   int len = StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8);
   if(len > 0) ArrayResize(data, len - 1); // buang karakter null di akhir

   string headers = "Content-Type: application/json\r\napikey: " + AnonKey + "\r\n";
   char   result[];
   string resultHeaders;

   ResetLastError();
   int code = WebRequest("POST", BaseUrl() + "/rest/v1/rpc/riskdesk_push", headers, 8000, data, result, resultHeaders);

   if(code == -1)
     {
      int err = GetLastError();
      if(err == 4014)
         g_status = "Izinkan URL di Tools > Options > Expert Advisors > Allow WebRequest: " + BaseUrl();
      else
         g_status = "Gagal terhubung (error " + IntegerToString(err) + ")";
      Print("RiskDesk Bridge: ", g_status);
     }
   else
     {
      string resp = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
      if(code != 200)
        {
         g_status = "HTTP " + IntegerToString(code) + ". Cek AnonKey dan supabase-setup.sql.";
         Print("RiskDesk Bridge: HTTP ", code, " ", resp);
        }
      else if(StringFind(resp, "false") >= 0)
         g_status = "SyncToken tidak dikenali. Salin ulang dari RiskDesk.";
      else
         g_status = "Tersinkron " + TimeToString(TimeLocal(), TIME_MINUTES | TIME_SECONDS) + " | " + IntegerToString(n - pend) + " posisi, " + IntegerToString(pend) + " pending";
     }
   Comment("RiskDesk Bridge\n", g_status);
  }
//+------------------------------------------------------------------+
