import {
  getSiteName,
  getShortname,
  getTagline,
  getParentSiteUrl,
  getParentSiteName,
  getGreeting,
  getLibraryMappings,
  getEnableSuggestedQueries,
  getEnableMediaTypeSelection,
  getEnableAuthorSelection,
  getWelcomePopupHeading,
  getOtherVisitorsReference,
  getLoginImage,
  getChatPlaceholder,
  getHeaderConfig,
  getFooterConfig,
  getRequireLogin,
  getAllowPrivateSessions,
  getAllowAllAnswersPage,
  getEnabledMediaTypes,
} from '@/utils/client/siteConfig';
import { SiteConfig } from '@/types/siteConfig';

describe('siteConfig utils', () => {
  const mockSiteConfig: SiteConfig = {
    siteId: 'test-site',
    name: 'Test Site',
    shortname: 'Test',
    tagline: 'Test Tagline',
    parent_site_url: 'https://test.com',
    parent_site_name: 'Parent Site',
    help_url: 'https://help.test.com',
    help_text: 'Get help here',
    greeting: 'Test Greeting',
    collectionConfig: { test: 'test' },
    libraryMappings: {
      test: {
        displayName: 'Test Library',
        url: 'https://library.test.com',
      },
    },
    enableSuggestedQueries: true,
    enableMediaTypeSelection: true,
    enableAuthorSelection: true,
    welcome_popup_heading: 'Test Welcome',
    other_visitors_reference: 'test visitors',
    loginImage: 'test.jpg',
    chatPlaceholder: 'Test placeholder',
    header: {
      logo: 'logo.png',
      navItems: [{ label: 'Test', path: '/test' }],
    },
    footer: {
      links: [{ label: 'Test', url: '/test' }],
    },
    requireLogin: false,
    allowPrivateSessions: true,
    allowAllAnswersPage: true,
    npsSurveyFrequencyDays: 30,
    queriesPerUserPerDay: 100,
    enabledMediaTypes: ['text', 'audio'],
  };

  describe('with null config', () => {
    it('returns default values when config is null', () => {
      expect(getSiteName(null)).toBe('The AI Chatbot');
      expect(getShortname(null)).toBe('AI Chatbot');
      expect(getTagline(null)).toBe('Explore, Discover, Learn');
      expect(getParentSiteUrl(null)).toBe('');
      expect(getParentSiteName(null)).toBe('');
      expect(getGreeting(null)).toBe('Hello! How can I assist you today?');
      expect(getLibraryMappings(null)).toEqual({});
      expect(getEnableSuggestedQueries(null)).toBe(false);
      expect(getEnableMediaTypeSelection(null)).toBe(false);
      expect(getEnableAuthorSelection(null)).toBe(false);
      expect(getWelcomePopupHeading(null)).toBe('Welcome!');
      expect(getOtherVisitorsReference(null)).toBe('other visitors');
      expect(getLoginImage(null)).toBe(null);
      expect(getChatPlaceholder(null)).toBe('');
      expect(getHeaderConfig(null)).toEqual({ logo: '', navItems: [] });
      expect(getFooterConfig(null)).toEqual({ links: [] });
      expect(getRequireLogin(null)).toBe(true);
      expect(getAllowPrivateSessions(null)).toBe(false);
      expect(getAllowAllAnswersPage(null)).toBe(false);
      expect(getEnabledMediaTypes(null)).toEqual(['text', 'audio', 'youtube']);
    });
  });

  describe('with valid config', () => {
    it('returns configured values when config is provided', () => {
      expect(getSiteName(mockSiteConfig)).toBe('Test Site');
      expect(getShortname(mockSiteConfig)).toBe('Test');
      expect(getTagline(mockSiteConfig)).toBe('Test Tagline');
      expect(getParentSiteUrl(mockSiteConfig)).toBe('https://test.com');
      expect(getParentSiteName(mockSiteConfig)).toBe('Parent Site');
      expect(getGreeting(mockSiteConfig)).toBe('Test Greeting');
      expect(getLibraryMappings(mockSiteConfig)).toEqual({
        test: {
          displayName: 'Test Library',
          url: 'https://library.test.com',
        },
      });
      expect(getEnableSuggestedQueries(mockSiteConfig)).toBe(true);
      expect(getEnableMediaTypeSelection(mockSiteConfig)).toBe(true);
      expect(getEnableAuthorSelection(mockSiteConfig)).toBe(true);
      expect(getWelcomePopupHeading(mockSiteConfig)).toBe('Test Welcome');
      expect(getOtherVisitorsReference(mockSiteConfig)).toBe('test visitors');
      expect(getLoginImage(mockSiteConfig)).toBe('test.jpg');
      expect(getChatPlaceholder(mockSiteConfig)).toBe('Test placeholder');
      expect(getHeaderConfig(mockSiteConfig)).toEqual({
        logo: 'logo.png',
        navItems: [{ label: 'Test', path: '/test' }],
      });
      expect(getFooterConfig(mockSiteConfig)).toEqual({
        links: [{ label: 'Test', url: '/test' }],
      });
      expect(getRequireLogin(mockSiteConfig)).toBe(false);
      expect(getAllowPrivateSessions(mockSiteConfig)).toBe(true);
      expect(getAllowAllAnswersPage(mockSiteConfig)).toBe(true);
      expect(getEnabledMediaTypes(mockSiteConfig)).toEqual(['text', 'audio']);
    });
  });
});
