#include <Arduino.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <cstring>

// =====================================================
// CONFIGURATION
// Must match TXNoiseDebug.ino
// =====================================================

static constexpr uint8_t WIFI_CHANNEL = 1;
static constexpr size_t MAX_MESSAGE_LENGTH = 48;
static constexpr uint32_t PACKET_MAGIC = 0x51524543;
static constexpr uint8_t REPETITION_FACTOR = 3;

// =====================================================
// PACKET FORMAT
// Must match the transmitter exactly.
// =====================================================

struct TxPacket {
  uint32_t magic;
  uint32_t sequence;
  uint8_t noisePercent;
  uint8_t messageLength;
  uint16_t flipCount;
  char raw[MAX_MESSAGE_LENGTH];
  uint8_t noisyPacked[MAX_MESSAGE_LENGTH * 3];
};

static_assert(sizeof(TxPacket) <= ESP_NOW_MAX_DATA_LEN,
              "Packet exceeds ESP-NOW v1 payload limit");

// =====================================================
// RECEIVE BUFFER
// The callback copies data; JSON output occurs in loop().
// =====================================================

TxPacket receivedPacket;
volatile bool packetReady = false;
char senderMac[18] = "unknown";
uint32_t receivedCount = 0;

// =====================================================
// FORMAT MAC ADDRESS
// =====================================================

void formatMac(const uint8_t *mac, char *output, size_t size) {
  snprintf(
    output,
    size,
    "%02X:%02X:%02X:%02X:%02X:%02X",
    mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]
  );
}

// =====================================================
// ESP-NOW RECEIVE CALLBACK
//
// No decoding, correction, or serial printing here:
// loop() decodes the copied packet.
// =====================================================

void onDataReceived(
  const esp_now_recv_info_t *info,
  const uint8_t *data,
  int dataLength
) {
  if (dataLength != (int)sizeof(TxPacket)) {
    return;
  }

  if (packetReady) {
    // Do not overwrite a packet that has not yet been
    // processed by loop(). This packet is dropped.
    return;
  }

  TxPacket incoming;
  memcpy(&incoming, data, sizeof(incoming));

  if (incoming.magic != PACKET_MAGIC) {
    return;
  }

  if (incoming.messageLength > MAX_MESSAGE_LENGTH) {
    return;
  }

  memcpy(&receivedPacket, &incoming, sizeof(incoming));

  if (info != nullptr && info->src_addr != nullptr) {
    formatMac(info->src_addr, senderMac, sizeof(senderMac));
  } else {
    strcpy(senderMac, "unknown");
  }

  packetReady = true;
}

// =====================================================
// DECODING (runs in loop(), never in the callback)
//
// Each source bit arrives as REPETITION_FACTOR noisy
// copies. The decoder only sees those copies: it does
// not read the noise setting or the raw text field.
// =====================================================

struct DecodeResult {
  char withoutQec[MAX_MESSAGE_LENGTH];
  char withQec[MAX_MESSAGE_LENGTH];
  uint16_t correctionsApplied;
  uint32_t decodeMicros;
};

uint8_t readBit(const uint8_t *buffer, size_t bitIndex) {
  return (buffer[bitIndex / 8] >> (7 - (bitIndex % 8))) & 1;
}

// Syndrome decoding, the same rule as the QRecall lab:
// the parity checks s_i = copy_(i-1) XOR copy_i fix the
// error pattern up to a global flip, and the decoder
// keeps the candidate that flips fewer copies. With one
// noise level for every copy, this equals a majority vote.
uint8_t decodeBlock(const uint8_t *copies, bool &syndromeFired) {
  uint8_t error = 0;        // candidate A: copy 0 is clean
  uint8_t weightA = 0;      // copies candidate A flips
  syndromeFired = false;

  for (uint8_t i = 1; i < REPETITION_FACTOR; i++) {
    const uint8_t syndrome = copies[i - 1] ^ copies[i];

    if (syndrome) {
      syndromeFired = true;
    }

    error ^= syndrome;
    weightA += error;
  }

  // Candidate B is the complement of A (copy 0 flipped).
  const uint8_t weightB = REPETITION_FACTOR - weightA;
  return copies[0] ^ (weightB < weightA ? 1 : 0);
}

void decodePacket(const TxPacket &packet, DecodeResult &out) {
  memset(&out, 0, sizeof(out));

  const uint32_t start = micros();
  size_t bitIndex = 0;

  for (size_t charIndex = 0;
       charIndex < packet.messageLength;
       charIndex++) {

    uint8_t unprotectedByte = 0;
    uint8_t decodedByte = 0;

    for (uint8_t bitPosition = 0; bitPosition < 8; bitPosition++) {
      uint8_t copies[REPETITION_FACTOR];

      for (uint8_t copyIndex = 0;
           copyIndex < REPETITION_FACTOR;
           copyIndex++) {
        copies[copyIndex] = readBit(packet.noisyPacked, bitIndex++);
      }

      bool syndromeFired = false;
      const uint8_t decodedBit = decodeBlock(copies, syndromeFired);

      if (syndromeFired) {
        out.correctionsApplied++;
      }

      // Without QEC: keep only the first copy, which went
      // through exactly the same noise as the other copies.
      unprotectedByte = (uint8_t)((unprotectedByte << 1) | copies[0]);
      decodedByte = (uint8_t)((decodedByte << 1) | decodedBit);
    }

    out.withoutQec[charIndex] = (char)unprotectedByte;
    out.withQec[charIndex] = (char)decodedByte;
  }

  out.decodeMicros = micros() - start;
}

// Scoring only: compares a decoded text with the raw
// field the transmitter sent alongside the payload.
void countErrors(const char *sent, const char *received, size_t length,
                 uint16_t &bitErrors, uint16_t &charErrors) {
  bitErrors = 0;
  charErrors = 0;

  for (size_t i = 0; i < length; i++) {
    const uint8_t diff = (uint8_t)sent[i] ^ (uint8_t)received[i];

    if (diff) {
      charErrors++;
      bitErrors += __builtin_popcount(diff);
    }
  }
}

// =====================================================
// JSON STRING ESCAPING
// =====================================================

void printJsonString(const char *value, size_t length) {
  Serial.print('"');

  for (size_t i = 0; i < length; i++) {
    unsigned char c = (unsigned char)value[i];

    switch (c) {
      case '"':
        Serial.print("\\\"");
        break;

      case '\\':
        Serial.print("\\\\");
        break;

      case '\b':
        Serial.print("\\b");
        break;

      case '\f':
        Serial.print("\\f");
        break;

      case '\n':
        Serial.print("\\n");
        break;

      case '\r':
        Serial.print("\\r");
        break;

      case '\t':
        Serial.print("\\t");
        break;

      default:
        // Noisy text can hold any byte; escaping everything
        // outside printable ASCII keeps each record valid JSON.
        if (c < 0x20 || c >= 0x7F) {
          Serial.printf("\\u%04X", c);
        } else {
          Serial.write(c);
        }
        break;
    }
  }

  Serial.print('"');
}

// =====================================================
// PRINT ONE JSON RECORD
//
// noisy_encoded_hex stores the packed noisy bits.
// Every character corresponds to 3 bytes / 24 bits.
// without_qec / with_qec are the receiver's two results;
// the *_errors fields compare them with raw.
// =====================================================

void printJsonRecord(const TxPacket &packet, const DecodeResult &decoded,
                     const char *mac) {
  const size_t encodedBytes = (size_t)packet.messageLength * 3;
  const size_t encodedBits = (size_t)packet.messageLength * 24;

  const float observedNoise = encodedBits > 0
    ? (100.0f * packet.flipCount / encodedBits)
    : 0.0f;

  Serial.print("{\"seq\":");
  Serial.print(packet.sequence);

  Serial.print(",\"raw\":");
  printJsonString(packet.raw, packet.messageLength);

  Serial.print(",\"noise_percent\":");
  Serial.print(packet.noisePercent);

  Serial.print(",\"flip_count\":");
  Serial.print(packet.flipCount);

  Serial.print(",\"encoded_bits_per_char\":24");

  Serial.print(",\"encoded_bits_total\":");
  Serial.print(encodedBits);

  Serial.print(",\"observed_noise_percent\":");
  Serial.print(observedNoise, 2);

  Serial.print(",\"noisy_encoded_hex\":\"");

  for (size_t i = 0; i < encodedBytes; i++) {
    Serial.printf("%02X", packet.noisyPacked[i]);
  }

  Serial.print('"');

  uint16_t bitErrorsWithout = 0, charErrorsWithout = 0;
  uint16_t bitErrorsWith = 0, charErrorsWith = 0;
  countErrors(packet.raw, decoded.withoutQec, packet.messageLength,
              bitErrorsWithout, charErrorsWithout);
  countErrors(packet.raw, decoded.withQec, packet.messageLength,
              bitErrorsWith, charErrorsWith);

  Serial.print(",\"without_qec\":");
  printJsonString(decoded.withoutQec, packet.messageLength);

  Serial.print(",\"with_qec\":");
  printJsonString(decoded.withQec, packet.messageLength);

  Serial.print(",\"bit_errors_without_qec\":");
  Serial.print(bitErrorsWithout);

  Serial.print(",\"bit_errors_with_qec\":");
  Serial.print(bitErrorsWith);

  Serial.print(",\"char_errors_without_qec\":");
  Serial.print(charErrorsWithout);

  Serial.print(",\"char_errors_with_qec\":");
  Serial.print(charErrorsWith);

  Serial.print(",\"corrections_applied\":");
  Serial.print(decoded.correctionsApplied);

  Serial.print(",\"decode_us\":");
  Serial.print(decoded.decodeMicros);

  Serial.print(",\"sender_mac\":");
  printJsonString(mac, strlen(mac));

  Serial.print(",\"receiver_count\":");
  Serial.print(++receivedCount);

  Serial.println("}");
}

// =====================================================
// SETUP
// =====================================================

void setup() {
  Serial.begin(115200);
  delay(1000);

  WiFi.mode(WIFI_STA);
  WiFi.disconnect();

  if (esp_wifi_set_channel(
        WIFI_CHANNEL, WIFI_SECOND_CHAN_NONE) != ESP_OK) {
    Serial.println("ERROR: Could not set Wi-Fi channel.");
    while (true) delay(1000);
  }

  if (esp_now_init() != ESP_OK) {
    Serial.println("ERROR: ESP-NOW initialization failed.");
    while (true) delay(1000);
  }

  if (esp_now_register_recv_cb(onDataReceived) != ESP_OK) {
    Serial.println("ERROR: Receive callback registration failed.");
    while (true) delay(1000);
  }

  // Setup text is not JSON. The PC logger will ignore
  // lines that are not valid JSON records.
  Serial.println("QRecall RX ready.");
  Serial.print("RX MAC: ");
  Serial.println(WiFi.macAddress());
  Serial.printf("Listening on channel %u\n", WIFI_CHANNEL);
}

// =====================================================
// MAIN LOOP
// =====================================================

void loop() {
  if (packetReady) {
    // Copy the packet while briefly preventing the callback
    // from replacing it.
    noInterrupts();

    TxPacket localPacket;
    memcpy(&localPacket, &receivedPacket, sizeof(localPacket));

    char localMac[18];
    memcpy(localMac, senderMac, sizeof(localMac));
    localMac[sizeof(localMac) - 1] = '\0';

    packetReady = false;

    interrupts();

    DecodeResult decoded;
    decodePacket(localPacket, decoded);
    printJsonRecord(localPacket, decoded, localMac);
  }

  delay(1);
}
