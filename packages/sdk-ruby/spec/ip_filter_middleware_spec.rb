# frozen_string_literal: true

require "spec_helper"
require "rack"
require "json"

RSpec.describe PocketPing::Middleware::IpFilterMiddleware do
  # A trivial downstream app that records being called.
  let(:downstream) do
    calls = []
    app = ->(_env) { calls << :called; [200, { "Content-Type" => "text/plain" }, ["ok"]] }
    app.define_singleton_method(:calls) { calls }
    app
  end

  def env_for(path, ip: "203.0.113.5", headers: {})
    base = Rack::MockRequest.env_for(path, "REMOTE_ADDR" => ip)
    headers.each { |k, v| base[k] = v }
    base
  end

  describe "#initialize" do
    it "raises when the pocketping option is missing" do
      expect { described_class.new(downstream) }.to raise_error(ArgumentError, /pocketping option is required/)
    end

    it "accepts a pocketping client" do
      client = PocketPing::Client.new
      expect { described_class.new(downstream, pocketping: client) }.not_to raise_error
    end
  end

  describe "#call" do
    it "passes through requests outside the path prefix" do
      client = PocketPing::Client.new(ip_filter: { enabled: true, mode: "blocklist", blocklist: ["0.0.0.0/0"] })
      mw = described_class.new(downstream, pocketping: client, path_prefix: "/pocketping")

      status, _headers, body = mw.call(env_for("/other"))
      expect(status).to eq(200)
      expect(body).to eq(["ok"])
      expect(downstream.calls).to eq([:called])
    end

    it "passes through when IP filtering is not configured" do
      client = PocketPing::Client.new
      mw = described_class.new(downstream, pocketping: client)

      status, = mw.call(env_for("/pocketping/connect"))
      expect(status).to eq(200)
      expect(downstream.calls).to eq([:called])
    end

    it "passes through when IP filtering is disabled" do
      client = PocketPing::Client.new(ip_filter: { enabled: false, blocklist: ["0.0.0.0/0"] })
      mw = described_class.new(downstream, pocketping: client)

      status, = mw.call(env_for("/pocketping/connect"))
      expect(status).to eq(200)
      expect(downstream.calls).to eq([:called])
    end

    it "allows an IP not on the blocklist" do
      client = PocketPing::Client.new(ip_filter: { enabled: true, mode: "blocklist", blocklist: ["10.0.0.0/8"] })
      mw = described_class.new(downstream, pocketping: client)

      status, = mw.call(env_for("/pocketping/connect", ip: "203.0.113.5"))
      expect(status).to eq(200)
      expect(downstream.calls).to eq([:called])
    end

    it "blocks an IP on the blocklist with a 403 JSON body" do
      client = PocketPing::Client.new(ip_filter: { enabled: true, mode: "blocklist", blocklist: ["203.0.113.0/24"] })
      mw = described_class.new(downstream, pocketping: client)

      status, headers, body = mw.call(env_for("/pocketping/connect", ip: "203.0.113.5"))
      expect(status).to eq(403)
      expect(headers["Content-Type"]).to eq("application/json")
      expect(JSON.parse(body.first)).to eq({ "error" => "Forbidden" })
      expect(downstream.calls).to be_empty
    end

    it "uses a custom blocked status code and message" do
      client = PocketPing::Client.new(ip_filter: {
        enabled: true,
        mode: "allowlist",
        allowlist: ["10.0.0.1"],
        blocked_status_code: 451,
        blocked_message: "Nope"
      })
      mw = described_class.new(downstream, pocketping: client)

      status, _headers, body = mw.call(env_for("/pocketping/connect", ip: "203.0.113.5"))
      expect(status).to eq(451)
      expect(JSON.parse(body.first)).to eq({ "error" => "Nope" })
    end

    it "resolves the client IP from the X-Forwarded-For header" do
      client = PocketPing::Client.new(ip_filter: { enabled: true, mode: "blocklist", blocklist: ["198.51.100.7"] })
      mw = described_class.new(downstream, pocketping: client)

      env = env_for("/pocketping/connect", ip: "10.0.0.1", headers: { "HTTP_X_FORWARDED_FOR" => "198.51.100.7, 10.0.0.1" })
      status, = mw.call(env)
      expect(status).to eq(403)
    end
  end
end
