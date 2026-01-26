import { h } from 'preact';
import { useState, useRef, useEffect } from 'preact/hooks';
import { parsePhoneNumber, isValidPhoneNumber } from 'libphonenumber-js/min';
import type { CountryCode } from 'libphonenumber-js/min';
import type { PocketPingClient } from '../client';
import type { PreChatFormConfig } from '../types';
import { countries, defaultCountry, type Country } from '../data/countries';

interface Props {
  client: PocketPingClient;
  config: PreChatFormConfig;
  onComplete: () => void;
  onSkip: () => void;
}

type ActiveTab = 'email' | 'phone';

// SVG icons
const EmailIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="M22 7l-10 7L2 7" />
  </svg>
);

const PhoneIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z" />
  </svg>
);

const ChevronIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M6 9l6 6 6-6" />
  </svg>
);

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function PreChatForm({ client, config, onComplete, onSkip }: Props) {
  // Determine which tabs to show based on config.fields
  const showEmailOnly = config.fields === 'email-only';
  const showPhoneOnly = config.fields === 'phone-only';
  const showBoth = config.fields === 'email-and-phone';
  const showChoice = config.fields === 'email-or-phone';

  // Default tab based on config
  const getDefaultTab = (): ActiveTab => {
    if (showPhoneOnly) return 'phone';
    return 'email';
  };

  const [activeTab, setActiveTab] = useState<ActiveTab>(getDefaultTab());
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [selectedCountry, setSelectedCountry] = useState<Country>(defaultCountry);
  const [isCountryDropdownOpen, setIsCountryDropdownOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState('');
  const [emailError, setEmailError] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const countryDropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (countryDropdownRef.current && !countryDropdownRef.current.contains(e.target as Node)) {
        setIsCountryDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isCountryDropdownOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isCountryDropdownOpen]);

  // Filter countries based on search
  const filteredCountries = countries.filter(
    (c) =>
      c.name.toLowerCase().includes(countrySearch.toLowerCase()) ||
      c.dialCode.includes(countrySearch) ||
      c.code.toLowerCase().includes(countrySearch.toLowerCase())
  );

  const handleCountrySelect = (country: Country) => {
    setSelectedCountry(country);
    setIsCountryDropdownOpen(false);
    setCountrySearch('');
  };

  const formatPhoneForDisplay = (value: string): string => {
    // Remove non-digit characters except for leading +
    const digits = value.replace(/\D/g, '');
    return digits;
  };

  const handlePhoneChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const formatted = formatPhoneForDisplay(target.value);
    setPhone(formatted);
    setPhoneError('');
  };

  const getFullPhoneNumber = (): string => {
    if (!phone) return '';
    return `${selectedCountry.dialCode}${phone}`;
  };

  const validateForm = (): boolean => {
    let valid = true;

    if (showEmailOnly || showBoth) {
      if (!email.trim()) {
        setEmailError('Email is required');
        valid = false;
      } else if (!isValidEmail(email)) {
        setEmailError('Please enter a valid email');
        valid = false;
      }
    }

    if (showPhoneOnly || showBoth) {
      const fullPhone = getFullPhoneNumber();
      if (!phone.trim()) {
        setPhoneError('Phone number is required');
        valid = false;
      } else if (!isValidPhoneNumber(fullPhone, selectedCountry.code as CountryCode)) {
        setPhoneError('Please enter a valid phone number');
        valid = false;
      }
    }

    // For "email or phone" mode, validate the active tab
    if (showChoice) {
      if (activeTab === 'email') {
        if (!email.trim()) {
          setEmailError('Email is required');
          valid = false;
        } else if (!isValidEmail(email)) {
          setEmailError('Please enter a valid email');
          valid = false;
        }
      } else {
        const fullPhone = getFullPhoneNumber();
        if (!phone.trim()) {
          setPhoneError('Phone number is required');
          valid = false;
        } else if (!isValidPhoneNumber(fullPhone, selectedCountry.code as CountryCode)) {
          setPhoneError('Please enter a valid phone number');
          valid = false;
        }
      }
    }

    return valid;
  };

  const handleSubmit = async (e: Event) => {
    e.preventDefault();

    if (!validateForm()) return;

    setIsSubmitting(true);

    try {
      const data: { email?: string; phone?: string; phoneCountry?: string } = {};

      // Include email if email field is shown/selected
      if (showEmailOnly || showBoth || (showChoice && activeTab === 'email')) {
        data.email = email.trim();
      }

      // Include phone if phone field is shown/selected
      if (showPhoneOnly || showBoth || (showChoice && activeTab === 'phone')) {
        const fullPhone = getFullPhoneNumber();
        // Parse and format to E.164
        const parsed = parsePhoneNumber(fullPhone, selectedCountry.code as CountryCode);
        if (parsed) {
          data.phone = parsed.format('E.164');
          data.phoneCountry = selectedCountry.code;
        }
      }

      await client.submitPreChat(data);
      onComplete();
    } catch (err) {
      console.error('[PreChatForm] Submit error:', err);
      // Show generic error
      if (activeTab === 'email' || showEmailOnly || showBoth) {
        setEmailError('Something went wrong. Please try again.');
      } else {
        setPhoneError('Something went wrong. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderEmailField = () => (
    <div class="pp-prechat-field">
      <label class="pp-prechat-label">Email address</label>
      <input
        type="email"
        class={`pp-prechat-input ${emailError ? 'error' : ''}`}
        placeholder="you@example.com"
        value={email}
        onInput={(e) => {
          setEmail((e.target as HTMLInputElement).value);
          setEmailError('');
        }}
      />
      {emailError && <div class="pp-prechat-error">{emailError}</div>}
    </div>
  );

  const renderPhoneField = () => (
    <div class="pp-prechat-field">
      <label class="pp-prechat-label">Phone number</label>
      <div class="pp-phone-input-wrapper">
        <div class="pp-country-select" ref={countryDropdownRef}>
          <button
            type="button"
            class="pp-country-btn"
            onClick={() => setIsCountryDropdownOpen(!isCountryDropdownOpen)}
          >
            <span class="pp-country-flag">{selectedCountry.flag}</span>
            <span class="pp-country-code">{selectedCountry.dialCode}</span>
            <ChevronIcon />
          </button>
          {isCountryDropdownOpen && (
            <div class="pp-country-dropdown">
              <div class="pp-country-search">
                <input
                  ref={searchInputRef}
                  type="text"
                  class="pp-country-search-input"
                  placeholder="Search country..."
                  value={countrySearch}
                  onInput={(e) => setCountrySearch((e.target as HTMLInputElement).value)}
                />
              </div>
              <div class="pp-country-list">
                {filteredCountries.map((country) => (
                  <div
                    key={country.code}
                    class={`pp-country-option ${country.code === selectedCountry.code ? 'selected' : ''}`}
                    onClick={() => handleCountrySelect(country)}
                  >
                    <span class="pp-country-flag">{country.flag}</span>
                    <span class="pp-country-name">{country.name}</span>
                    <span class="pp-country-dial">{country.dialCode}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <input
          type="tel"
          class={`pp-prechat-input pp-phone-number-input ${phoneError ? 'error' : ''}`}
          placeholder="612 345 678"
          value={phone}
          onInput={handlePhoneChange}
        />
      </div>
      {phoneError && <div class="pp-prechat-error">{phoneError}</div>}
    </div>
  );

  return (
    <div class="pp-prechat">
      <h2 class="pp-prechat-title">How can we reach you?</h2>
      <p class="pp-prechat-subtitle">
        {showBoth
          ? 'Please provide your contact information so we can follow up if needed.'
          : showChoice
            ? 'Choose how you would like us to contact you.'
            : showEmailOnly
              ? 'Enter your email so we can follow up with you.'
              : 'Enter your phone number so we can call you back.'}
      </p>

      <form onSubmit={handleSubmit}>
        {/* Show tabs only for "email or phone" mode */}
        {showChoice && (
          <div class="pp-prechat-tabs">
            <button
              type="button"
              class={`pp-prechat-tab ${activeTab === 'email' ? 'active' : ''}`}
              onClick={() => {
                setActiveTab('email');
                setPhoneError('');
              }}
            >
              <EmailIcon />
              Email
            </button>
            <button
              type="button"
              class={`pp-prechat-tab ${activeTab === 'phone' ? 'active' : ''}`}
              onClick={() => {
                setActiveTab('phone');
                setEmailError('');
              }}
            >
              <PhoneIcon />
              Phone
            </button>
          </div>
        )}

        {/* Email only */}
        {showEmailOnly && renderEmailField()}

        {/* Phone only */}
        {showPhoneOnly && renderPhoneField()}

        {/* Both email and phone */}
        {showBoth && (
          <>
            {renderEmailField()}
            {renderPhoneField()}
          </>
        )}

        {/* Email or phone (tabs) */}
        {showChoice && (
          <>
            {activeTab === 'email' && renderEmailField()}
            {activeTab === 'phone' && renderPhoneField()}
          </>
        )}

        <button type="submit" class="pp-prechat-submit" disabled={isSubmitting}>
          {isSubmitting ? 'Submitting...' : 'Start chatting'}
        </button>

        {/* Skip button only if form is not required */}
        {!config.required && (
          <button type="button" class="pp-prechat-skip" onClick={onSkip}>
            Skip for now
          </button>
        )}
      </form>
    </div>
  );
}
