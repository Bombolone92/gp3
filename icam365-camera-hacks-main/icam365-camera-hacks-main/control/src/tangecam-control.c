#define _POSIX_C_SOURCE 200809L

#include <arpa/inet.h>
#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <netdb.h>
#include <poll.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#define SERVICE_NAME "tangecam-control"
#define SERVICE_VERSION "0.1.0"
#define DEFAULT_BIND "0.0.0.0"
#define DEFAULT_PORT 8080
#define DEFAULT_PTZ_SCRIPT "/tmp/mnt/mmc01/0/tangecam/ptz.sh"
#define DEFAULT_LIGHT_HOST "127.0.0.1"
#define DEFAULT_LIGHT_PORT 8001
#define DEFAULT_TIMEOUT_MS 5000
#define HEADER_LIMIT 8192
#define BODY_LIMIT 2048
#define PTZ_ARG_LIMIT 2
#define COMMAND_OUTPUT_LIMIT 1024

typedef struct {
    const char *bind_address;
    uint16_t port;
    const char *ptz_script;
    const char *light_host;
    uint16_t light_port;
    int timeout_ms;
} Config;

typedef struct {
    char method[8];
    char path[256];
    char content_type[128];
    size_t content_length;
    bool has_content_length;
    char body[BODY_LIMIT + 1];
} HttpRequest;

typedef struct {
    int status;
    const char *code;
    const char *message;
} ApiError;

typedef struct {
    char action[32];
    int32_t args[PTZ_ARG_LIMIT];
    size_t arg_count;
    bool args_present;
    bool hold;
    bool hold_present;
} PtzRequest;

typedef struct {
    char mode[8];
} LightRequest;

typedef struct {
    const char *current;
    const char *end;
} JsonCursor;

typedef enum {
    COMMAND_OK,
    COMMAND_UNAVAILABLE,
    COMMAND_TIMEOUT,
    COMMAND_FAILED
} CommandKind;

typedef struct {
    CommandKind kind;
    int exit_code;
    char output[COMMAND_OUTPUT_LIMIT + 1];
} CommandResult;

typedef enum {
    UPSTREAM_OK,
    UPSTREAM_TIMEOUT,
    UPSTREAM_CONNECT_ERROR,
    UPSTREAM_PROTOCOL_ERROR,
    UPSTREAM_HTTP_ERROR
} UpstreamKind;

typedef struct {
    UpstreamKind kind;
    int http_status;
} UpstreamResult;

static volatile sig_atomic_t stop_requested = 0;

static bool append_json_string(char *destination, size_t capacity,
                               size_t *used, const char *source);

static void handle_signal(int signal_number) {
    (void)signal_number;
    stop_requested = 1;
}

static int64_t monotonic_milliseconds(void) {
    struct timespec now;

    if (clock_gettime(CLOCK_MONOTONIC, &now) != 0) {
        return 0;
    }
    return (int64_t)now.tv_sec * 1000 + now.tv_nsec / 1000000;
}

static const char *status_reason(int status) {
    switch (status) {
        case 200:
            return "OK";
        case 400:
            return "Bad Request";
        case 404:
            return "Not Found";
        case 405:
            return "Method Not Allowed";
        case 408:
            return "Request Timeout";
        case 411:
            return "Length Required";
        case 413:
            return "Content Too Large";
        case 415:
            return "Unsupported Media Type";
        case 422:
            return "Unprocessable Content";
        case 431:
            return "Request Header Fields Too Large";
        case 500:
            return "Internal Server Error";
        case 502:
            return "Bad Gateway";
        case 503:
            return "Service Unavailable";
        case 504:
            return "Gateway Timeout";
        default:
            return "Error";
    }
}

static bool send_all(int fd, const char *data, size_t length) {
    size_t sent = 0;

    while (sent < length) {
        ssize_t written = send(fd, data + sent, length - sent, MSG_NOSIGNAL);
        if (written > 0) {
            sent += (size_t)written;
            continue;
        }
        if (written < 0 && errno == EINTR) {
            continue;
        }
        return false;
    }
    return true;
}

static void send_json_with_headers(int fd, int status, const char *json,
                                   const char *extra_headers) {
    char headers[768];
    size_t body_length = strlen(json);
    int header_length = snprintf(
        headers, sizeof(headers),
        "HTTP/1.1 %d %s\r\n"
        "Server: " SERVICE_NAME "/" SERVICE_VERSION "\r\n"
        "Content-Type: application/json; charset=utf-8\r\n"
        "Content-Length: %zu\r\n"
        "Cache-Control: no-store\r\n"
        "%s"
        "Connection: close\r\n\r\n",
        status, status_reason(status), body_length,
        extra_headers == NULL ? "" : extra_headers);

    if (header_length <= 0 || (size_t)header_length >= sizeof(headers)) {
        return;
    }
    (void)send_all(fd, headers, (size_t)header_length);
    (void)send_all(fd, json, body_length);
}

static void send_json(int fd, int status, const char *json) {
    send_json_with_headers(fd, status, json, NULL);
}

static void send_error(int fd, int status, const char *code,
                       const char *message) {
    char body[1536];
    size_t used = 0;
    static const char prefix[] =
        "{\"ok\":false,\"error\":{\"code\":";
    static const char middle[] = ",\"message\":";

    memcpy(body + used, prefix, sizeof(prefix) - 1);
    used += sizeof(prefix) - 1;
    if (!append_json_string(body, sizeof(body), &used, code)) {
        send_json(fd, 500,
                  "{\"ok\":false,\"error\":{\"code\":\"internal_error\","
                  "\"message\":\"failed to create response\"}}\n");
        return;
    }
    memcpy(body + used, middle, sizeof(middle) - 1);
    used += sizeof(middle) - 1;
    if (!append_json_string(body, sizeof(body), &used, message) ||
        used + 4 > sizeof(body)) {
        send_json(fd, 500,
                  "{\"ok\":false,\"error\":{\"code\":\"internal_error\","
                  "\"message\":\"failed to create response\"}}\n");
        return;
    }
    memcpy(body + used, "}}\n", 4);
    send_json(fd, status, body);
}

static ssize_t find_header_end(const char *data, size_t length) {
    if (length < 4) {
        return -1;
    }
    for (size_t index = 0; index + 3 < length; ++index) {
        if (data[index] == '\r' && data[index + 1] == '\n' &&
            data[index + 2] == '\r' && data[index + 3] == '\n') {
            return (ssize_t)(index + 4);
        }
    }
    return -1;
}

static char *trim_ascii_space(char *value) {
    char *end;

    while (*value == ' ' || *value == '\t') {
        ++value;
    }
    end = value + strlen(value);
    while (end > value && (end[-1] == ' ' || end[-1] == '\t')) {
        --end;
    }
    *end = '\0';
    return value;
}

static bool parse_content_length(const char *value, size_t *result) {
    uint64_t parsed = 0;

    if (*value == '\0') {
        return false;
    }
    for (const unsigned char *cursor = (const unsigned char *)value;
         *cursor != '\0'; ++cursor) {
        uint64_t digit;

        if (!isdigit(*cursor)) {
            return false;
        }
        digit = (uint64_t)(*cursor - '0');
        if (parsed > (uint64_t)SIZE_MAX / 10 ||
            (parsed == (uint64_t)SIZE_MAX / 10 &&
             digit > (uint64_t)SIZE_MAX % 10)) {
            return false;
        }
        parsed = parsed * 10 + digit;
    }
    *result = (size_t)parsed;
    return true;
}

static bool is_json_content_type(const char *value) {
    static const char expected[] = "application/json";
    size_t expected_length = sizeof(expected) - 1;

    while (*value == ' ' || *value == '\t') {
        ++value;
    }
    if (strncasecmp(value, expected, expected_length) != 0) {
        return false;
    }
    value += expected_length;
    while (*value == ' ' || *value == '\t') {
        ++value;
    }
    return *value == '\0' || *value == ';';
}

static bool parse_headers(char *headers, HttpRequest *request,
                          ApiError *error) {
    char version[16];
    char trailing;
    char *line_end = strstr(headers, "\r\n");
    char *line;

    if (line_end == NULL) {
        *error = (ApiError){400, "invalid_request", "missing HTTP request line"};
        return false;
    }
    *line_end = '\0';
    if (sscanf(headers, "%7s %255s %15s %c", request->method,
               request->path, version, &trailing) != 3 ||
        (strcmp(version, "HTTP/1.0") != 0 &&
         strcmp(version, "HTTP/1.1") != 0)) {
        *error = (ApiError){400, "invalid_request", "invalid HTTP request line"};
        return false;
    }

    line = line_end + 2;
    while (*line != '\0') {
        char *next = strstr(line, "\r\n");
        char *separator;
        char *name;
        char *value;

        if (next == NULL) {
            *error = (ApiError){400, "invalid_request", "malformed HTTP headers"};
            return false;
        }
        if (next == line) {
            break;
        }
        *next = '\0';
        separator = strchr(line, ':');
        if (separator == NULL || separator == line) {
            *error = (ApiError){400, "invalid_request", "malformed HTTP header"};
            return false;
        }
        *separator = '\0';
        name = line;
        value = trim_ascii_space(separator + 1);

        if (strcasecmp(name, "Content-Length") == 0) {
            if (request->has_content_length ||
                !parse_content_length(value, &request->content_length)) {
                *error = (ApiError){400, "invalid_content_length",
                                    "Content-Length must be one non-negative integer"};
                return false;
            }
            request->has_content_length = true;
        } else if (strcasecmp(name, "Content-Type") == 0) {
            if (strlen(value) >= sizeof(request->content_type)) {
                *error = (ApiError){400, "invalid_content_type",
                                    "Content-Type is too long"};
                return false;
            }
            strcpy(request->content_type, value);
        } else if (strcasecmp(name, "Transfer-Encoding") == 0 &&
                   *value != '\0') {
            *error = (ApiError){400, "unsupported_transfer_encoding",
                                "Transfer-Encoding is not supported"};
            return false;
        }
        line = next + 2;
    }

    if (request->content_length > BODY_LIMIT) {
        *error = (ApiError){413, "body_too_large",
                            "request body exceeds 2048 bytes"};
        return false;
    }
    if (strcmp(request->method, "POST") == 0) {
        if (!request->has_content_length) {
            *error = (ApiError){411, "length_required",
                                "POST requests require Content-Length"};
            return false;
        }
    }
    return true;
}

static bool read_http_request(int fd, HttpRequest *request, ApiError *error) {
    char raw[HEADER_LIMIT + BODY_LIMIT + 1];
    char headers[HEADER_LIMIT + 1];
    size_t received = 0;
    ssize_t header_end = -1;

    memset(request, 0, sizeof(*request));
    while (header_end < 0) {
        ssize_t count;

        if (received >= HEADER_LIMIT) {
            *error = (ApiError){431, "headers_too_large",
                                "request headers exceed 8192 bytes"};
            return false;
        }
        count = recv(fd, raw + received, HEADER_LIMIT - received, 0);
        if (count > 0) {
            received += (size_t)count;
            header_end = find_header_end(raw, received);
            continue;
        }
        if (count < 0 && errno == EINTR) {
            continue;
        }
        if (count < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
            *error = (ApiError){408, "request_timeout",
                                "timed out while reading request"};
            return false;
        }
        *error = (ApiError){400, "incomplete_request",
                            "connection closed before request was complete"};
        return false;
    }

    memcpy(headers, raw, (size_t)header_end);
    headers[header_end] = '\0';
    if (!parse_headers(headers, request, error)) {
        return false;
    }

    size_t body_received = received - (size_t)header_end;
    if (body_received > request->content_length) {
        body_received = request->content_length;
    }
    if (body_received > 0) {
        memcpy(request->body, raw + header_end, body_received);
    }
    while (body_received < request->content_length) {
        ssize_t count = recv(fd, request->body + body_received,
                             request->content_length - body_received, 0);
        if (count > 0) {
            body_received += (size_t)count;
            continue;
        }
        if (count < 0 && errno == EINTR) {
            continue;
        }
        if (count < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
            *error = (ApiError){408, "request_timeout",
                                "timed out while reading request body"};
            return false;
        }
        *error = (ApiError){400, "incomplete_body",
                            "connection closed before request body was complete"};
        return false;
    }
    request->body[request->content_length] = '\0';
    if (strcmp(request->method, "POST") == 0 &&
        !is_json_content_type(request->content_type)) {
        *error = (ApiError){415, "unsupported_media_type",
                            "Content-Type must be application/json"};
        return false;
    }
    return true;
}

static void json_skip_whitespace(JsonCursor *cursor) {
    while (cursor->current < cursor->end &&
           (*cursor->current == ' ' || *cursor->current == '\t' ||
            *cursor->current == '\r' || *cursor->current == '\n')) {
        ++cursor->current;
    }
}

static bool json_consume(JsonCursor *cursor, char expected) {
    json_skip_whitespace(cursor);
    if (cursor->current >= cursor->end || *cursor->current != expected) {
        return false;
    }
    ++cursor->current;
    return true;
}

static int hex_digit(char value) {
    if (value >= '0' && value <= '9') {
        return value - '0';
    }
    if (value >= 'a' && value <= 'f') {
        return value - 'a' + 10;
    }
    if (value >= 'A' && value <= 'F') {
        return value - 'A' + 10;
    }
    return -1;
}

static bool json_parse_string(JsonCursor *cursor, char *output,
                              size_t output_size) {
    size_t length = 0;

    json_skip_whitespace(cursor);
    if (cursor->current >= cursor->end || *cursor->current != '"') {
        return false;
    }
    ++cursor->current;
    while (cursor->current < cursor->end) {
        unsigned char value = (unsigned char)*cursor->current++;

        if (value == '"') {
            if (length >= output_size) {
                return false;
            }
            output[length] = '\0';
            return true;
        }
        if (value < 0x20) {
            return false;
        }
        if (value == '\\') {
            unsigned char escaped;

            if (cursor->current >= cursor->end) {
                return false;
            }
            escaped = (unsigned char)*cursor->current++;
            switch (escaped) {
                case '"':
                case '\\':
                case '/':
                    value = escaped;
                    break;
                case 'b':
                    value = '\b';
                    break;
                case 'f':
                    value = '\f';
                    break;
                case 'n':
                    value = '\n';
                    break;
                case 'r':
                    value = '\r';
                    break;
                case 't':
                    value = '\t';
                    break;
                case 'u': {
                    unsigned codepoint = 0;
                    for (int index = 0; index < 4; ++index) {
                        int digit;
                        if (cursor->current >= cursor->end ||
                            (digit = hex_digit(*cursor->current++)) < 0) {
                            return false;
                        }
                        codepoint = codepoint * 16 + (unsigned)digit;
                    }
                    if (codepoint == 0 || codepoint > 0x7f) {
                        return false;
                    }
                    value = (unsigned char)codepoint;
                    break;
                }
                default:
                    return false;
            }
        }
        if (length + 1 >= output_size) {
            return false;
        }
        output[length++] = (char)value;
    }
    return false;
}

static bool json_parse_int32(JsonCursor *cursor, int32_t *result) {
    const char *start;
    const char *number_end;
    char buffer[32];
    char *conversion_end;
    long long parsed;
    size_t length;

    json_skip_whitespace(cursor);
    start = cursor->current;
    if (cursor->current < cursor->end && *cursor->current == '-') {
        ++cursor->current;
    }
    if (cursor->current >= cursor->end ||
        !isdigit((unsigned char)*cursor->current)) {
        cursor->current = start;
        return false;
    }
    if (*cursor->current == '0') {
        ++cursor->current;
        if (cursor->current < cursor->end &&
            isdigit((unsigned char)*cursor->current)) {
            cursor->current = start;
            return false;
        }
    } else {
        while (cursor->current < cursor->end &&
               isdigit((unsigned char)*cursor->current)) {
            ++cursor->current;
        }
    }
    number_end = cursor->current;
    if (cursor->current < cursor->end &&
        (*cursor->current == '.' || *cursor->current == 'e' ||
         *cursor->current == 'E')) {
        cursor->current = start;
        return false;
    }
    length = (size_t)(number_end - start);
    if (length == 0 || length >= sizeof(buffer)) {
        cursor->current = start;
        return false;
    }
    memcpy(buffer, start, length);
    buffer[length] = '\0';
    errno = 0;
    parsed = strtoll(buffer, &conversion_end, 10);
    if (errno != 0 || *conversion_end != '\0' || parsed < INT32_MIN ||
        parsed > INT32_MAX) {
        cursor->current = start;
        return false;
    }
    *result = (int32_t)parsed;
    return true;
}

static bool json_parse_bool(JsonCursor *cursor, bool *result) {
    json_skip_whitespace(cursor);
    if ((size_t)(cursor->end - cursor->current) >= 4 &&
        memcmp(cursor->current, "true", 4) == 0) {
        cursor->current += 4;
        *result = true;
        return true;
    }
    if ((size_t)(cursor->end - cursor->current) >= 5 &&
        memcmp(cursor->current, "false", 5) == 0) {
        cursor->current += 5;
        *result = false;
        return true;
    }
    return false;
}

static bool json_parse_int_array(JsonCursor *cursor, int32_t *values,
                                 size_t *count) {
    *count = 0;
    if (!json_consume(cursor, '[')) {
        return false;
    }
    json_skip_whitespace(cursor);
    if (cursor->current < cursor->end && *cursor->current == ']') {
        ++cursor->current;
        return true;
    }
    for (;;) {
        if (*count >= PTZ_ARG_LIMIT ||
            !json_parse_int32(cursor, &values[*count])) {
            return false;
        }
        ++*count;
        json_skip_whitespace(cursor);
        if (cursor->current < cursor->end && *cursor->current == ']') {
            ++cursor->current;
            return true;
        }
        if (cursor->current >= cursor->end || *cursor->current != ',') {
            return false;
        }
        ++cursor->current;
    }
}

static bool json_object_next(JsonCursor *cursor, bool *finished,
                             bool first_field) {
    json_skip_whitespace(cursor);
    if (cursor->current < cursor->end && *cursor->current == '}') {
        ++cursor->current;
        *finished = true;
        return true;
    }
    if (!first_field) {
        if (cursor->current >= cursor->end || *cursor->current != ',') {
            return false;
        }
        ++cursor->current;
    }
    *finished = false;
    return true;
}

static bool json_document_finished(JsonCursor *cursor) {
    json_skip_whitespace(cursor);
    return cursor->current == cursor->end;
}

static bool parse_ptz_json(const HttpRequest *request, PtzRequest *parsed,
                           ApiError *error) {
    JsonCursor cursor = {request->body,
                         request->body + request->content_length};
    bool has_action = false;
    bool has_args = false;
    bool has_hold = false;
    bool first_field = true;

    memset(parsed, 0, sizeof(*parsed));
    if (!json_consume(&cursor, '{')) {
        *error = (ApiError){400, "invalid_json",
                            "request body must be a JSON object"};
        return false;
    }
    for (;;) {
        bool finished;
        char key[32];

        if (!json_object_next(&cursor, &finished, first_field)) {
            *error = (ApiError){400, "invalid_json", "malformed JSON object"};
            return false;
        }
        if (finished) {
            break;
        }
        first_field = false;
        if (!json_parse_string(&cursor, key, sizeof(key)) ||
            !json_consume(&cursor, ':')) {
            *error = (ApiError){400, "invalid_json", "malformed JSON field"};
            return false;
        }
        if (strcmp(key, "action") == 0) {
            if (has_action) {
                *error = (ApiError){400, "duplicate_field",
                                    "field \"action\" appears more than once"};
                return false;
            }
            has_action = true;
            if (!json_parse_string(&cursor, parsed->action,
                                   sizeof(parsed->action))) {
                *error = (ApiError){400, "invalid_field_type",
                                    "field \"action\" must be a short string"};
                return false;
            }
        } else if (strcmp(key, "args") == 0) {
            if (has_args) {
                *error = (ApiError){400, "duplicate_field",
                                    "field \"args\" appears more than once"};
                return false;
            }
            has_args = true;
            parsed->args_present = true;
            if (!json_parse_int_array(&cursor, parsed->args,
                                      &parsed->arg_count)) {
                *error = (ApiError){400, "invalid_field_type",
                                    "field \"args\" must contain at most two signed 32-bit integers"};
                return false;
            }
        } else if (strcmp(key, "hold") == 0) {
            if (has_hold) {
                *error = (ApiError){400, "duplicate_field",
                                    "field \"hold\" appears more than once"};
                return false;
            }
            has_hold = true;
            parsed->hold_present = true;
            if (!json_parse_bool(&cursor, &parsed->hold)) {
                *error = (ApiError){400, "invalid_field_type",
                                    "field \"hold\" must be a JSON boolean"};
                return false;
            }
        } else {
            *error = (ApiError){400, "unknown_field",
                                "PTZ request accepts only \"action\", \"args\", and \"hold\""};
            return false;
        }
    }
    if (!json_document_finished(&cursor)) {
        *error = (ApiError){400, "invalid_json",
                            "unexpected data after JSON object"};
        return false;
    }
    if (!has_action || parsed->action[0] == '\0') {
        *error = (ApiError){422, "missing_action",
                            "field \"action\" is required"};
        return false;
    }
    return true;
}

static bool parse_light_json(const HttpRequest *request, LightRequest *parsed,
                             ApiError *error) {
    JsonCursor cursor = {request->body,
                         request->body + request->content_length};
    bool has_mode = false;
    bool first_field = true;

    memset(parsed, 0, sizeof(*parsed));
    if (!json_consume(&cursor, '{')) {
        *error = (ApiError){400, "invalid_json",
                            "request body must be a JSON object"};
        return false;
    }
    for (;;) {
        bool finished;
        char key[32];

        if (!json_object_next(&cursor, &finished, first_field)) {
            *error = (ApiError){400, "invalid_json", "malformed JSON object"};
            return false;
        }
        if (finished) {
            break;
        }
        first_field = false;
        if (!json_parse_string(&cursor, key, sizeof(key)) ||
            !json_consume(&cursor, ':')) {
            *error = (ApiError){400, "invalid_json", "malformed JSON field"};
            return false;
        }
        if (strcmp(key, "mode") != 0) {
            *error = (ApiError){400, "unknown_field",
                                "light request accepts only \"mode\""};
            return false;
        }
        if (has_mode) {
            *error = (ApiError){400, "duplicate_field",
                                "field \"mode\" appears more than once"};
            return false;
        }
        has_mode = true;
        if (!json_parse_string(&cursor, parsed->mode, sizeof(parsed->mode))) {
            *error = (ApiError){400, "invalid_field_type",
                                "field \"mode\" must be a short string"};
            return false;
        }
    }
    if (!json_document_finished(&cursor)) {
        *error = (ApiError){400, "invalid_json",
                            "unexpected data after JSON object"};
        return false;
    }
    if (!has_mode || parsed->mode[0] == '\0') {
        *error = (ApiError){422, "missing_mode", "field \"mode\" is required"};
        return false;
    }
    return true;
}

static bool valid_ptz_action(const char *action) {
    static const char *const actions[] = {
        "left",     "right",    "up",      "down",    "lu",
        "ru",       "ld",       "rd",      "stop",    "zoom-in",
        "zoom-out", "cruise",   "scan",    "speed",   "pos",
        "reset"};

    for (size_t index = 0; index < sizeof(actions) / sizeof(actions[0]);
         ++index) {
        if (strcmp(action, actions[index]) == 0) {
            return true;
        }
    }
    return false;
}

static bool ptz_action_supports_hold(const char *action) {
    static const char *const directions[] = {
        "left", "right", "up", "down", "lu", "ru", "ld", "rd"};

    for (size_t index = 0;
         index < sizeof(directions) / sizeof(directions[0]); ++index) {
        if (strcmp(action, directions[index]) == 0) {
            return true;
        }
    }
    return false;
}

static size_t drain_command_output(int fd, char *output, size_t used) {
    char discarded[256];

    for (;;) {
        char *destination = discarded;
        size_t capacity = sizeof(discarded);
        ssize_t count;

        if (used < COMMAND_OUTPUT_LIMIT) {
            destination = output + used;
            capacity = COMMAND_OUTPUT_LIMIT - used;
        }
        count = read(fd, destination, capacity);
        if (count > 0) {
            if (used < COMMAND_OUTPUT_LIMIT) {
                size_t kept = (size_t)count;
                if (kept > COMMAND_OUTPUT_LIMIT - used) {
                    kept = COMMAND_OUTPUT_LIMIT - used;
                }
                used += kept;
            }
            continue;
        }
        if (count < 0 && errno == EINTR) {
            continue;
        }
        break;
    }
    output[used] = '\0';
    return used;
}

static CommandResult run_ptz_command(const Config *config,
                                     const PtzRequest *request) {
    CommandResult result;
    int pipe_fds[2];
    pid_t child;
    char argument_buffers[PTZ_ARG_LIMIT][16];
    char speed_argument[sizeof(argument_buffers[0]) * 2 + 1];
    char *arguments[6];

    memset(&result, 0, sizeof(result));
    if (access(config->ptz_script, R_OK) != 0) {
        result.kind = COMMAND_UNAVAILABLE;
        return result;
    }
    if (pipe(pipe_fds) != 0) {
        result.kind = COMMAND_FAILED;
        result.exit_code = -1;
        return result;
    }

    child = fork();
    if (child < 0) {
        close(pipe_fds[0]);
        close(pipe_fds[1]);
        result.kind = COMMAND_FAILED;
        result.exit_code = -1;
        return result;
    }
    if (child == 0) {
        size_t argument_count = 0;

        (void)setpgid(0, 0);
        close(pipe_fds[0]);
        (void)dup2(pipe_fds[1], STDOUT_FILENO);
        (void)dup2(pipe_fds[1], STDERR_FILENO);
        if (pipe_fds[1] != STDOUT_FILENO && pipe_fds[1] != STDERR_FILENO) {
            close(pipe_fds[1]);
        }

        arguments[argument_count++] = (char *)"sh";
        arguments[argument_count++] = (char *)config->ptz_script;
        arguments[argument_count++] = (char *)request->action;
        if (request->hold) {
            arguments[argument_count++] = (char *)"--hold";
        } else if (request->arg_count == 2) {
            (void)snprintf(argument_buffers[0], sizeof(argument_buffers[0]),
                           "%d", request->args[0]);
            (void)snprintf(argument_buffers[1], sizeof(argument_buffers[1]),
                           "%d", request->args[1]);
            (void)snprintf(speed_argument, sizeof(speed_argument), "%s %s",
                           argument_buffers[0], argument_buffers[1]);
            arguments[argument_count++] = speed_argument;
        }
        arguments[argument_count] = NULL;
        execv("/bin/sh", arguments);
        (void)write(STDERR_FILENO, "cannot execute /bin/sh\n", 23);
        _exit(127);
    }

    close(pipe_fds[1]);
    (void)setpgid(child, child);
    int flags = fcntl(pipe_fds[0], F_GETFL, 0);
    if (flags >= 0) {
        (void)fcntl(pipe_fds[0], F_SETFL, flags | O_NONBLOCK);
    }

    int64_t deadline = monotonic_milliseconds() + config->timeout_ms;
    size_t output_used = 0;
    int wait_status = 0;

    for (;;) {
        pid_t wait_result;
        struct pollfd poll_fd = {pipe_fds[0], POLLIN, 0};
        int remaining;

        output_used = drain_command_output(pipe_fds[0], result.output,
                                           output_used);
        wait_result = waitpid(child, &wait_status, WNOHANG);
        if (wait_result == child) {
            break;
        }
        if (wait_result < 0 && errno != EINTR) {
            result.kind = COMMAND_FAILED;
            result.exit_code = -1;
            close(pipe_fds[0]);
            return result;
        }

        remaining = (int)(deadline - monotonic_milliseconds());
        if (remaining <= 0) {
            (void)kill(-child, SIGKILL);
            (void)kill(child, SIGKILL);
            while (waitpid(child, &wait_status, 0) < 0 && errno == EINTR) {
            }
            (void)drain_command_output(pipe_fds[0], result.output,
                                       output_used);
            close(pipe_fds[0]);
            result.kind = COMMAND_TIMEOUT;
            return result;
        }
        if (remaining > 20) {
            remaining = 20;
        }
        (void)poll(&poll_fd, 1, remaining);
    }

    output_used = drain_command_output(pipe_fds[0], result.output, output_used);
    close(pipe_fds[0]);
    while (output_used > 0 &&
           (result.output[output_used - 1] == '\n' ||
            result.output[output_used - 1] == '\r')) {
        result.output[--output_used] = '\0';
    }

    if (WIFEXITED(wait_status)) {
        result.exit_code = WEXITSTATUS(wait_status);
    } else if (WIFSIGNALED(wait_status)) {
        result.exit_code = 128 + WTERMSIG(wait_status);
    } else {
        result.exit_code = -1;
    }
    result.kind = result.exit_code == 0 ? COMMAND_OK : COMMAND_FAILED;
    return result;
}

static int connect_with_timeout(const struct addrinfo *address,
                                int timeout_ms, bool *timed_out) {
    int fd = socket(address->ai_family, address->ai_socktype,
                    address->ai_protocol);
    int flags;
    int connect_result;

    if (fd < 0) {
        return -1;
    }
    flags = fcntl(fd, F_GETFL, 0);
    if (flags < 0 || fcntl(fd, F_SETFL, flags | O_NONBLOCK) != 0) {
        close(fd);
        return -1;
    }
    connect_result = connect(fd, address->ai_addr, address->ai_addrlen);
    if (connect_result != 0 && errno != EINPROGRESS) {
        close(fd);
        return -1;
    }
    if (connect_result != 0) {
        struct pollfd poll_fd = {fd, POLLOUT, 0};
        int poll_result;

        do {
            poll_result = poll(&poll_fd, 1, timeout_ms);
        } while (poll_result < 0 && errno == EINTR);
        if (poll_result == 0) {
            *timed_out = true;
            close(fd);
            return -1;
        }
        if (poll_result < 0) {
            close(fd);
            return -1;
        }
        int socket_error = 0;
        socklen_t error_length = sizeof(socket_error);
        if (getsockopt(fd, SOL_SOCKET, SO_ERROR, &socket_error,
                       &error_length) != 0 ||
            socket_error != 0) {
            close(fd);
            return -1;
        }
    }
    if (fcntl(fd, F_SETFL, flags) != 0) {
        close(fd);
        return -1;
    }
    return fd;
}

static UpstreamResult set_light_mode(const Config *config, const char *mode) {
    UpstreamResult result = {UPSTREAM_CONNECT_ERROR, 0};
    struct addrinfo hints;
    struct addrinfo *addresses = NULL;
    struct addrinfo *address;
    char port[8];
    int fd = -1;
    bool timed_out = false;

    memset(&hints, 0, sizeof(hints));
    hints.ai_family = AF_UNSPEC;
    hints.ai_socktype = SOCK_STREAM;
    (void)snprintf(port, sizeof(port), "%u", config->light_port);
    if (getaddrinfo(config->light_host, port, &hints, &addresses) != 0) {
        return result;
    }
    for (address = addresses; address != NULL; address = address->ai_next) {
        fd = connect_with_timeout(address, config->timeout_ms, &timed_out);
        if (fd >= 0) {
            break;
        }
    }
    freeaddrinfo(addresses);
    if (fd < 0) {
        result.kind = timed_out ? UPSTREAM_TIMEOUT : UPSTREAM_CONNECT_ERROR;
        return result;
    }

    struct timeval timeout = {
        .tv_sec = config->timeout_ms / 1000,
        .tv_usec = (config->timeout_ms % 1000) * 1000};
    (void)setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
    (void)setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));

    char request[512];
    int request_length = snprintf(
        request, sizeof(request),
        "GET /whitelight?mode=%s HTTP/1.0\r\n"
        "Host: %s:%u\r\n"
        "User-Agent: " SERVICE_NAME "/" SERVICE_VERSION "\r\n"
        "Connection: close\r\n\r\n",
        mode, config->light_host, config->light_port);
    if (request_length <= 0 || (size_t)request_length >= sizeof(request) ||
        !send_all(fd, request, (size_t)request_length)) {
        if (errno == EAGAIN || errno == EWOULDBLOCK) {
            result.kind = UPSTREAM_TIMEOUT;
        }
        close(fd);
        return result;
    }

    char status_line[256];
    size_t used = 0;
    while (used + 1 < sizeof(status_line)) {
        ssize_t count = recv(fd, status_line + used,
                             sizeof(status_line) - used - 1, 0);
        if (count > 0) {
            used += (size_t)count;
            status_line[used] = '\0';
            if (strstr(status_line, "\r\n") != NULL) {
                break;
            }
            continue;
        }
        if (count < 0 && errno == EINTR) {
            continue;
        }
        if (count < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
            result.kind = UPSTREAM_TIMEOUT;
        } else {
            result.kind = UPSTREAM_PROTOCOL_ERROR;
        }
        close(fd);
        return result;
    }
    close(fd);
    status_line[used] = '\0';
    if (sscanf(status_line, "HTTP/%*u.%*u %d", &result.http_status) != 1) {
        result.kind = UPSTREAM_PROTOCOL_ERROR;
        return result;
    }
    result.kind = result.http_status >= 200 && result.http_status < 300
                      ? UPSTREAM_OK
                      : UPSTREAM_HTTP_ERROR;
    return result;
}

static size_t utf8_sequence_length(const unsigned char *value) {
    if (value[0] >= 0xc2 && value[0] <= 0xdf &&
        value[1] >= 0x80 && value[1] <= 0xbf) {
        return 2;
    }
    if (((value[0] == 0xe0 && value[1] >= 0xa0 && value[1] <= 0xbf) ||
         (value[0] >= 0xe1 && value[0] <= 0xec &&
          value[1] >= 0x80 && value[1] <= 0xbf) ||
         (value[0] == 0xed && value[1] >= 0x80 && value[1] <= 0x9f) ||
         (value[0] >= 0xee && value[0] <= 0xef &&
          value[1] >= 0x80 && value[1] <= 0xbf)) &&
        value[2] >= 0x80 && value[2] <= 0xbf) {
        return 3;
    }
    if (((value[0] == 0xf0 && value[1] >= 0x90 && value[1] <= 0xbf) ||
         (value[0] >= 0xf1 && value[0] <= 0xf3 &&
          value[1] >= 0x80 && value[1] <= 0xbf) ||
         (value[0] == 0xf4 && value[1] >= 0x80 && value[1] <= 0x8f)) &&
        value[2] >= 0x80 && value[2] <= 0xbf &&
        value[3] >= 0x80 && value[3] <= 0xbf) {
        return 4;
    }
    return 0;
}

static bool append_json_string(char *destination, size_t capacity,
                               size_t *used, const char *source) {
    static const char hex[] = "0123456789abcdef";

    if (*used + 1 >= capacity) {
        return false;
    }
    destination[(*used)++] = '"';
    for (const unsigned char *cursor = (const unsigned char *)source;
         *cursor != '\0'; ++cursor) {
        unsigned char value = *cursor;

        if (value == '"' || value == '\\') {
            if (*used + 2 >= capacity) {
                return false;
            }
            destination[(*used)++] = '\\';
            destination[(*used)++] = (char)value;
        } else if (value >= 0x20 && value <= 0x7e) {
            if (*used + 1 >= capacity) {
                return false;
            }
            destination[(*used)++] = (char)value;
        } else if (value >= 0x80) {
            size_t sequence_length = utf8_sequence_length(cursor);
            if (sequence_length > 0) {
                if (*used + sequence_length >= capacity) {
                    return false;
                }
                memcpy(destination + *used, cursor, sequence_length);
                *used += sequence_length;
                cursor += sequence_length - 1;
                continue;
            }
            if (*used + 6 >= capacity) {
                return false;
            }
            destination[(*used)++] = '\\';
            destination[(*used)++] = 'u';
            destination[(*used)++] = '0';
            destination[(*used)++] = '0';
            destination[(*used)++] = hex[value >> 4];
            destination[(*used)++] = hex[value & 0x0f];
        } else {
            if (*used + 6 >= capacity) {
                return false;
            }
            destination[(*used)++] = '\\';
            destination[(*used)++] = 'u';
            destination[(*used)++] = '0';
            destination[(*used)++] = '0';
            destination[(*used)++] = hex[value >> 4];
            destination[(*used)++] = hex[value & 0x0f];
        }
    }
    if (*used + 2 > capacity) {
        return false;
    }
    destination[(*used)++] = '"';
    destination[*used] = '\0';
    return true;
}

static void handle_health(int fd, const Config *config, int64_t started_at) {
    bool ptz_ready = access(config->ptz_script, R_OK) == 0;
    int64_t uptime = (monotonic_milliseconds() - started_at) / 1000;
    char response[384];

    if (uptime < 0) {
        uptime = 0;
    }
    (void)snprintf(
        response, sizeof(response),
        "{\"ok\":%s,\"service\":\"%s\",\"version\":\"%s\","
        "\"uptime_seconds\":%lld,\"ptz_ready\":%s}\n",
        ptz_ready ? "true" : "false", SERVICE_NAME, SERVICE_VERSION,
        (long long)uptime, ptz_ready ? "true" : "false");
    send_json(fd, ptz_ready ? 200 : 503, response);
}

static void handle_ptz(int fd, const Config *config,
                       const HttpRequest *request) {
    PtzRequest parsed;
    ApiError error;

    if (!parse_ptz_json(request, &parsed, &error)) {
        send_error(fd, error.status, error.code, error.message);
        return;
    }
    if (!valid_ptz_action(parsed.action)) {
        send_error(fd, 422, "invalid_action",
                   "unsupported PTZ action");
        return;
    }
    if (strcmp(parsed.action, "speed") == 0 && parsed.arg_count != 2) {
        send_error(fd, 422, "invalid_args",
                   "PTZ action \"speed\" requires exactly two integer args: x-speed and y-speed");
        return;
    }
    if (strcmp(parsed.action, "speed") != 0 && parsed.args_present) {
        send_error(fd, 422, "invalid_args",
                   "only PTZ action \"speed\" accepts args");
        return;
    }
    if (parsed.hold_present && !ptz_action_supports_hold(parsed.action)) {
        send_error(fd, 422, "invalid_hold",
                   "field \"hold\" is valid only for directional PTZ actions");
        return;
    }

    CommandResult result = run_ptz_command(config, &parsed);
    if (result.kind == COMMAND_UNAVAILABLE) {
        send_error(fd, 503, "ptz_unavailable", "PTZ script is not readable");
        return;
    }
    if (result.kind == COMMAND_TIMEOUT) {
        send_error(fd, 504, "ptz_timeout", "PTZ command timed out");
        return;
    }

    char response[8192];
    size_t used = 0;
    int prefix_length;
    if (result.kind == COMMAND_FAILED) {
        prefix_length = snprintf(
            response, sizeof(response),
            "{\"ok\":false,\"error\":{\"code\":\"ptz_failed\","
            "\"message\":\"PTZ script returned a non-zero status\","
            "\"exit_code\":%d", result.exit_code);
        if (prefix_length <= 0 || (size_t)prefix_length >= sizeof(response)) {
            send_error(fd, 500, "internal_error", "failed to create response");
            return;
        }
        used = (size_t)prefix_length;
        if (result.output[0] != '\0') {
            const char label[] = ",\"output\":";
            memcpy(response + used, label, sizeof(label) - 1);
            used += sizeof(label) - 1;
            if (!append_json_string(response, sizeof(response), &used,
                                    result.output)) {
                send_error(fd, 500, "internal_error", "failed to create response");
                return;
            }
        }
        if (used + 4 >= sizeof(response)) {
            send_error(fd, 500, "internal_error", "failed to create response");
            return;
        }
        memcpy(response + used, "}}\n", 4);
        send_json(fd, 502, response);
        return;
    }

    prefix_length = snprintf(
        response, sizeof(response),
        "{\"ok\":true,\"action\":\"%s\"%s", parsed.action,
        parsed.hold ? ",\"hold\":true" : "");
    if (prefix_length <= 0 || (size_t)prefix_length >= sizeof(response)) {
        send_error(fd, 500, "internal_error", "failed to create response");
        return;
    }
    used = (size_t)prefix_length;
    if (result.output[0] != '\0') {
        const char label[] = ",\"output\":";
        memcpy(response + used, label, sizeof(label) - 1);
        used += sizeof(label) - 1;
        if (!append_json_string(response, sizeof(response), &used,
                                result.output)) {
            send_error(fd, 500, "internal_error", "failed to create response");
            return;
        }
    }
    if (used + 3 >= sizeof(response)) {
        send_error(fd, 500, "internal_error", "failed to create response");
        return;
    }
    memcpy(response + used, "}\n", 3);
    send_json(fd, 200, response);
}

static void handle_light(int fd, const Config *config,
                         const HttpRequest *request) {
    LightRequest parsed;
    ApiError error;

    if (!parse_light_json(request, &parsed, &error)) {
        send_error(fd, error.status, error.code, error.message);
        return;
    }
    if (strcmp(parsed.mode, "off") != 0 && strcmp(parsed.mode, "on") != 0 &&
        strcmp(parsed.mode, "2") != 0) {
        send_error(fd, 422, "invalid_mode",
                   "field \"mode\" must be \"off\", \"on\", or \"2\"");
        return;
    }

    UpstreamResult result = set_light_mode(config, parsed.mode);
    if (result.kind == UPSTREAM_TIMEOUT) {
        send_error(fd, 504, "light_timeout", "light CGI request timed out");
        return;
    }
    if (result.kind == UPSTREAM_CONNECT_ERROR) {
        send_error(fd, 502, "light_unreachable",
                   "could not connect to light CGI");
        return;
    }
    if (result.kind == UPSTREAM_PROTOCOL_ERROR) {
        send_error(fd, 502, "light_invalid_response",
                   "light CGI returned an invalid HTTP response");
        return;
    }
    if (result.kind == UPSTREAM_HTTP_ERROR) {
        char response[384];
        (void)snprintf(
            response, sizeof(response),
            "{\"ok\":false,\"error\":{\"code\":\"light_rejected\","
            "\"message\":\"light CGI returned a non-success status\","
            "\"upstream_status\":%d}}\n",
            result.http_status);
        send_json(fd, 502, response);
        return;
    }

    char response[192];
    (void)snprintf(response, sizeof(response),
                   "{\"ok\":true,\"mode\":\"%s\",\"upstream_status\":%d}\n",
                   parsed.mode, result.http_status);
    send_json(fd, 200, response);
}

static void method_not_allowed(int fd, const char *allowed) {
    char header[64];
    (void)snprintf(header, sizeof(header), "Allow: %s\r\n", allowed);
    send_json_with_headers(
        fd, 405,
        "{\"ok\":false,\"error\":{\"code\":\"method_not_allowed\","
        "\"message\":\"HTTP method is not allowed for this endpoint\"}}\n",
        header);
}

static void handle_connection(int fd, const Config *config,
                              int64_t started_at) {
    HttpRequest request;
    ApiError error;

    if (!read_http_request(fd, &request, &error)) {
        send_error(fd, error.status, error.code, error.message);
        return;
    }
    if (strcmp(request.path, "/health") == 0) {
        if (strcmp(request.method, "GET") != 0) {
            method_not_allowed(fd, "GET");
            return;
        }
        handle_health(fd, config, started_at);
        return;
    }
    if (strcmp(request.path, "/ptz") == 0) {
        if (strcmp(request.method, "POST") != 0) {
            method_not_allowed(fd, "POST");
            return;
        }
        handle_ptz(fd, config, &request);
        return;
    }
    if (strcmp(request.path, "/light") == 0) {
        if (strcmp(request.method, "POST") != 0) {
            method_not_allowed(fd, "POST");
            return;
        }
        handle_light(fd, config, &request);
        return;
    }
    send_error(fd, 404, "not_found", "endpoint not found");
}

static bool parse_port(const char *value, uint16_t *port) {
    char *end;
    long parsed;

    errno = 0;
    parsed = strtol(value, &end, 10);
    if (errno != 0 || *value == '\0' || *end != '\0' || parsed < 1 ||
        parsed > 65535) {
        return false;
    }
    *port = (uint16_t)parsed;
    return true;
}

static bool parse_timeout(const char *value, int *timeout_ms) {
    char *end;
    long parsed;

    errno = 0;
    parsed = strtol(value, &end, 10);
    if (errno != 0 || *value == '\0' || *end != '\0' || parsed < 100 ||
        parsed > 60000) {
        return false;
    }
    *timeout_ms = (int)parsed;
    return true;
}

static void print_usage(FILE *stream, const char *program) {
    fprintf(stream,
            "Usage: %s [options]\n"
            "\n"
            "Options:\n"
            "  --bind ADDRESS       Listen IPv4 address (default: %s)\n"
            "  --port PORT          Listen port (default: %d)\n"
            "  --ptz-script PATH    PTZ shell script (default: %s)\n"
            "  --light-host HOST    Light CGI host (default: %s)\n"
            "  --light-port PORT    Light CGI port (default: %d)\n"
            "  --timeout-ms MS      PTZ/CGI timeout, 100..60000 (default: %d)\n"
            "  --help               Show this help\n"
            "  --version            Show service version\n",
            program, DEFAULT_BIND, DEFAULT_PORT, DEFAULT_PTZ_SCRIPT,
            DEFAULT_LIGHT_HOST, DEFAULT_LIGHT_PORT, DEFAULT_TIMEOUT_MS);
}

static bool parse_arguments(int argc, char **argv, Config *config) {
    *config = (Config){DEFAULT_BIND, DEFAULT_PORT, DEFAULT_PTZ_SCRIPT,
                       DEFAULT_LIGHT_HOST, DEFAULT_LIGHT_PORT,
                       DEFAULT_TIMEOUT_MS};

    for (int index = 1; index < argc; ++index) {
        const char *option = argv[index];

        if (strcmp(option, "--help") == 0) {
            print_usage(stdout, argv[0]);
            exit(0);
        }
        if (strcmp(option, "--version") == 0) {
            printf("%s %s\n", SERVICE_NAME, SERVICE_VERSION);
            exit(0);
        }
        if (index + 1 >= argc) {
            fprintf(stderr, "%s requires a value\n", option);
            return false;
        }
        const char *value = argv[++index];
        if (strcmp(option, "--bind") == 0) {
            config->bind_address = value;
        } else if (strcmp(option, "--port") == 0) {
            if (!parse_port(value, &config->port)) {
                fprintf(stderr, "invalid --port: %s\n", value);
                return false;
            }
        } else if (strcmp(option, "--ptz-script") == 0) {
            config->ptz_script = value;
        } else if (strcmp(option, "--light-host") == 0) {
            config->light_host = value;
        } else if (strcmp(option, "--light-port") == 0) {
            if (!parse_port(value, &config->light_port)) {
                fprintf(stderr, "invalid --light-port: %s\n", value);
                return false;
            }
        } else if (strcmp(option, "--timeout-ms") == 0) {
            if (!parse_timeout(value, &config->timeout_ms)) {
                fprintf(stderr, "invalid --timeout-ms: %s\n", value);
                return false;
            }
        } else {
            fprintf(stderr, "unknown option: %s\n", option);
            return false;
        }
    }
    return true;
}

static int create_listener(const Config *config) {
    int fd = socket(AF_INET, SOCK_STREAM, 0);
    struct sockaddr_in address;
    int enabled = 1;

    if (fd < 0) {
        perror("socket");
        return -1;
    }
    (void)setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &enabled, sizeof(enabled));
    memset(&address, 0, sizeof(address));
    address.sin_family = AF_INET;
    address.sin_port = htons(config->port);
    if (inet_pton(AF_INET, config->bind_address, &address.sin_addr) != 1) {
        fprintf(stderr, "--bind must be an IPv4 address: %s\n",
                config->bind_address);
        close(fd);
        return -1;
    }
    if (bind(fd, (struct sockaddr *)&address, sizeof(address)) != 0) {
        perror("bind");
        close(fd);
        return -1;
    }
    if (listen(fd, 16) != 0) {
        perror("listen");
        close(fd);
        return -1;
    }
    return fd;
}

int main(int argc, char **argv) {
    Config config;
    struct sigaction action;
    int listener;
    int64_t started_at;

    if (!parse_arguments(argc, argv, &config)) {
        print_usage(stderr, argv[0]);
        return 2;
    }
    memset(&action, 0, sizeof(action));
    action.sa_handler = handle_signal;
    sigemptyset(&action.sa_mask);
    (void)sigaction(SIGINT, &action, NULL);
    (void)sigaction(SIGTERM, &action, NULL);
    (void)signal(SIGPIPE, SIG_IGN);

    listener = create_listener(&config);
    if (listener < 0) {
        return 1;
    }
    started_at = monotonic_milliseconds();
    fprintf(stderr, "%s %s listening on %s:%u\n", SERVICE_NAME,
            SERVICE_VERSION, config.bind_address, config.port);

    while (!stop_requested) {
        int client = accept(listener, NULL, NULL);
        struct timeval timeout = {.tv_sec = 5, .tv_usec = 0};

        if (client < 0) {
            if (errno == EINTR) {
                continue;
            }
            perror("accept");
            close(listener);
            return 1;
        }
        (void)setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, &timeout,
                         sizeof(timeout));
        (void)setsockopt(client, SOL_SOCKET, SO_SNDTIMEO, &timeout,
                         sizeof(timeout));
        handle_connection(client, &config, started_at);
        close(client);
    }

    close(listener);
    fprintf(stderr, "%s stopped\n", SERVICE_NAME);
    return 0;
}
