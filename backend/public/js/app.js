// ==========================================
// 1. CONFIGURATION & STATE
// ==========================================
var BACKEND_URL = 'https://ayurved-rasrasayan-github-io-1.onrender.com/api';
var exchangeRate = 133;
var products = [];
var cart = [];
var currentCategory = 'all';
var currentSort = 'name';
var PRODUCTS_PER_PAGE = 30;
var currentPage = 1;
var currentModalProduct = null;
var selectedForm = "Whole Form";
var selectedUnitValue = "1kg";
var selectedPaymentMethod = 'esewa';
var selectedPaymentCurrency = 'npr';
var rawFileForUpload = null;
var lastCompressedBase64 = null;
var authToken = localStorage.getItem('natura_token');
var currentUser = null;

// ==========================================
// 2. HELPERS
// ==========================================
function fetchWithTimeout(url, options, timeout) {
  timeout = timeout || 8000;
  return Promise.race([
    fetch(url, options),
    new Promise(function(_, reject) {
      setTimeout(function() { reject(new Error('Request timeout')); }, timeout);
    })
  ]);
}

function getUnitFactor(unit) {
  var map = {
    '10gm': 0.01, '125gm': 0.125, '250gm': 0.25, '500gm': 0.5, '1kg': 1,
    '15ml': 0.015, '30ml': 0.03, '50ml': 0.05, '100ml': 0.1,
    '200ml': 0.2, '500ml': 0.5, '1000ml': 1, '100gm': 1
  };
  return map[unit] || 1;
}

function calculateModalPrice(product, form, unit, qty) {
  if (!product) return 0;
  var unitFactor = getUnitFactor(unit);
  var priceNPR = product.price * unitFactor * qty;
  if (form === 'Powder Form') priceNPR += 50 * unitFactor * qty;
  return Math.round(priceNPR * 100) / 100;
}

function togglePassword(inputId, btn) {
  var input = document.getElementById(inputId);
  var icon = btn.querySelector('i');
  if (input.type === 'password') {
    input.type = 'text';
    icon.setAttribute('data-lucide', 'eye');
  } else {
    input.type = 'password';
    icon.setAttribute('data-lucide', 'eye-off');
  }
  lucide.createIcons();
}

// ==========================================
// 3. TOAST SYSTEM
// ==========================================
function showToast(msg, type) {
  type = type || 'success';
  var container = document.getElementById('toastContainer');
  var el = document.createElement('div');
  el.className = 'toast-enter bg-bg-light border border-txt-main shadow-md p-3 mb-2 text-sm pointer-events-auto font-medium uppercase text-xs tracking-wider rounded-md';
  el.innerHTML = '<i data-lucide="' + (type === 'success' ? 'check-circle' : 'alert-circle') + '" class="w-4 h-4 inline mr-2 ' + (type === 'success' ? 'text-brand' : 'text-red-500') + '"></i>' + msg;
  container.appendChild(el);
  lucide.createIcons();
  setTimeout(function() {
    el.classList.add('toast-exit');
    setTimeout(function() { el.remove(); }, 300);
  }, 2500);
}

// ==========================================
// 4. IMAGE COMPRESSION
// ==========================================
function compressImage(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function(e) {
      var img = new Image();
      img.onload = function() {
        var canvas = document.createElement('canvas');
        var MAX_WIDTH = 800;
        var width = img.width;
        var height = img.height;
        if (width > MAX_WIDTH) {
          height = (height * MAX_WIDTH) / width;
          width = MAX_WIDTH;
        }
        canvas.width = width;
        canvas.height = height;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.5));
      };
      img.onerror = function() { reject(new Error('Failed to load image')); };
      img.src = e.target.result;
    };
    reader.onerror = function() { reject(new Error('Failed to read file')); };
    reader.readAsDataURL(file);
  });
}

// ==========================================
// 5. PROCESSING / POPUP OVERLAYS
// ==========================================
function showProcessingOverlay(step) {
  var overlay = document.getElementById('processingOverlay');
  overlay.classList.remove('hidden');
  overlay.classList.add('flex');
  var s1 = document.getElementById('pStep1');
  var s2 = document.getElementById('pStep2');
  var s3 = document.getElementById('pStep3');
  var bar = document.getElementById('processingProgressBar');
  s1.className = 'flex items-center gap-3 opacity-40';
  s2.className = 'flex items-center gap-3 opacity-40';
  s3.className = 'flex items-center gap-3 opacity-40';
  if (step >= 1) { s1.className = 'flex items-center gap-3 step-active'; bar.style.width = '30%'; }
  if (step >= 2) { s1.className = 'flex items-center gap-3'; s2.className = 'flex items-center gap-3 step-active'; bar.style.width = '65%'; }
  if (step >= 3) { s2.className = 'flex items-center gap-3'; s3.className = 'flex items-center gap-3 step-active'; bar.style.width = '90%'; }
}

function hideProcessingOverlay() {
  var overlay = document.getElementById('processingOverlay');
  overlay.classList.add('hidden');
  overlay.classList.remove('flex');
}

function showSuccessPopup(orderId) {
  document.getElementById('successOrderId').textContent = '#' + (orderId || 'PENDING');
  var popup = document.getElementById('successPopup');
  popup.classList.remove('hidden');
  popup.classList.add('flex');
  lucide.createIcons();
  setTimeout(function() {
    popup.classList.add('hidden');
    popup.classList.remove('flex');
  }, 5000);
}

function showErrorPopup(message) {
  document.getElementById('errorMessage').textContent = message || 'Something went wrong. Please try again.';
  var popup = document.getElementById('errorPopup');
  popup.classList.remove('hidden');
  popup.classList.add('flex');
  lucide.createIcons();
}

function closeErrorPopup() {
  var popup = document.getElementById('errorPopup');
  popup.classList.add('hidden');
  popup.classList.remove('flex');
}

// ==========================================
// 6. EXCHANGE RATE
// ==========================================
async function loadExchangeRate() {
  try {
    var res = await fetchWithTimeout(BACKEND_URL + '/public/rate');
    if (res.ok) {
      var data = await res.json();
      if (data.rate && data.rate > 0) exchangeRate = data.rate;
    }
  } catch (e) {
    console.error('Rate fetch failed, using default 133:', e.message);
  }
  updateRateDisplays();
  loadProducts();
}

function updateRateDisplays() {
  var r = exchangeRate.toFixed(2);
  var label = document.getElementById('rateLabel');
  if (label) label.textContent = '$ prices at 1 USD = Rs. ' + r;
  var ft = document.getElementById('footerRateText');
  if (ft) ft.textContent = '1 USD = Rs. ' + r + ' NPR';
}

// ==========================================
// 7. VISITOR COUNTER
// ==========================================
async function loadVisitorCount() {
  try {
    var res = await fetchWithTimeout(BACKEND_URL + '/public/visits');
    if (res.ok) {
      var data = await res.json();
      if (data.count) {
        var el = document.getElementById('visitorCount');
        if (el) animateCounter(el, data.count);
      }
    }
  } catch (e) {
    console.error('Visitor count failed:', e.message);
  }
}

function animateCounter(el, target) {
  var current = 0;
  var interval = setInterval(function() {
    current += Math.ceil(target / 60);
    if (current >= target) { current = target; clearInterval(interval); }
    el.textContent = current.toLocaleString() + '+';
  }, 20);
}

// ==========================================
// 8. TRENDING PRODUCTS (3D COVERFLOW)
// ==========================================
async function loadTrending() {
  var wrapper = document.getElementById('trendingWrapper');
  try {
    var res = await fetchWithTimeout(BACKEND_URL + '/trending');
    var data = await res.json();

    if (!data || !data.picks || data.picks.length === 0) {
      document.getElementById('trendingSection').style.display = 'none';
      return;
    }

    var originalProducts = data.picks.map(function(p) {
      p.isPick = p.isPick || false;
      return p;
    });

    var totalOriginal = originalProducts.length;
    var infiniteProducts = [].concat(originalProducts, originalProducts, originalProducts);
    var startIndex = totalOriginal;

    wrapper.innerHTML = infiniteProducts.map(function(product) {
      var priceUSD = (product.price / exchangeRate).toLocaleString('en-US', { minimumFractionDigits: 2 });
      var imgSrc = product.img || product.image || 'https://placehold.co/400x300/1A3636/8A6E2F?text=NaturaBotanica';
      var productId = product.id || product._id; // Extract product ID
      return '<div class="swiper-slide" onclick="openModal(\'' + productId + '\')">' + // Added onclick
        (product.isPick ? '<div class="trending-badge"><i data-lucide="star" class="w-3 h-3"></i> Staff Pick</div>' : '') +
        '<img src="' + imgSrc + '" alt="' + product.name + '" class="trending-card-img">' +
        '<div class="trending-card-content">' +
          '<div class="trending-card-name">' + product.name + '</div>' +
          '<div class="trending-card-price">NPR ' + Math.round(product.price || 0).toLocaleString() +
          ' <span class="text-xs text-txt-sub font-normal">$' + priceUSD + '</span></div>' +
        '</div></div>';
    }).join('');

    setTimeout(function() {
      var isSnapping = false;
      new Swiper(".trendingSwiper", {
        effect: "coverflow",
        grabCursor: true,
        centeredSlides: true,
        slidesPerView: "auto",
        initialSlide: startIndex,
        coverflowEffect: { rotate: 5, stretch: 0, depth: 200, modifier: 1, slideShadows: false },
        autoplay: { delay: 4000, disableOnInteraction: false, pauseOnMouseEnter: true },
        loop: false,
        pagination: { el: ".swiper-pagination", clickable: true },
        breakpoints: {
          320: { slidesPerView: 1, coverflowEffect: { rotate: 0, depth: 100 } },
          768: { slidesPerView: "auto" }
        },
        on: {
          slideChange: function(swiper) {
            if (isSnapping) return;
            var current = swiper.activeIndex;
            if (current >= totalOriginal * 2) {
              isSnapping = true;
              swiper.slideTo(current - totalOriginal, 1);
              swiper.update();
              isSnapping = false;
            } else if (current < totalOriginal) {
              isSnapping = true;
              swiper.slideTo(current + totalOriginal, 1);
              swiper.update();
              isSnapping = false;
            }
          }
        }
      });
      lucide.createIcons();
    }, 300);

  } catch (error) {
    console.error('Failed to load trending products:', error);
    document.getElementById('trendingSection').style.display = 'none';
  }
}

// ==========================================
// 9. PRODUCTS & PAGINATION
// ==========================================
async function loadProducts() {
  var grid = document.getElementById('productGrid');
  grid.innerHTML = '<div class="col-span-full flex flex-col items-center py-20"><i data-lucide="loader-2" class="w-12 h-12 text-brand animate-spin mb-4"></i><p class="text-txt-sub uppercase tracking-wider">Loading products...</p></div>';
  lucide.createIcons();

  try {
    var res = await fetchWithTimeout(BACKEND_URL + '/products');
    if (!res.ok) throw new Error('API error');
    products = await res.json();
  } catch (e) {
    console.error('Products fetch failed, using fallback:', e.message);
    products = Array.from({ length: 65 }).map(function(_, i) {
      return {
        id: i + 1, name: 'Product ' + (i + 1), sci: 'Scientific name',
        category: ['oils','herbs','mushrooms','rasa','namak','herbal soap','extracts','seeds / masala'][i % 8],
        catLabel: ['Oils','Herbs','Mushrooms','Rasa','Namak','Herbal Soap','Extracts','Seeds / Masala'][i % 8],
        price: 500 + (i * 10), img: 'https://placehold.co/400x300/1A3636/8A6E2F?text=Product+' + (i + 1), // Updated Gold
        desc: 'High quality botanical ingredient sourced from the Himalayas.', moq: '1 kg', lead: '5-7 days', unit: '1 kg', stock: 10 + i
      };
    });
  }
  renderCatButtons();
  currentPage = 1;
  renderProducts(getFilteredProducts());
}

function renderCatButtons() {
  var cats = ['all','oils','extracts','mushrooms','herbs','rasa','namak','herbal soap','seeds / masala'];
  var icons = { 'all':'grid-3x3','oils':'droplet','extracts':'flask-conical','mushrooms':'nut','herbs':'leaf','rasa':'rocking-chair','namak':'sparkles','herbal soap':'droplets','seeds / masala':'wheat' };
  document.getElementById('catButtons').innerHTML = cats.map(function(c) {
    var displayName = c === 'herbal soap' ? 'Herbal Soap' : c === 'seeds / masala' ? 'Seeds / Masala' : c.charAt(0).toUpperCase() + c.slice(1);
    return '<button onclick="filterCategory(\'' + c + '\')" class="cat-btn group p-3 border border-txt-main hover:border-brand transition-all text-center rounded-lg" data-cat="' + c + '">' + // Updated border
      '<div class="w-9 h-9 mx-auto mb-2 border border-txt-main flex items-center justify-center bg-brand text-white rounded-full">' + // Updated border
      '<i data-lucide="' + icons[c] + '" class="w-4 h-4"></i></div>' +
      '<span class="text-[10px] font-medium uppercase tracking-wider">' + displayName + '</span></button>';
  }).join('');
  lucide.createIcons();
}

function getFilteredProducts() {
  var filtered = products.slice();
  if (currentCategory !== 'all') filtered = filtered.filter(function(p) { return p.category === currentCategory; });
  if (currentSort === 'name') filtered.sort(function(a, b) { return a.name.localeCompare(b.name); });
  if (currentSort === 'price-asc') filtered.sort(function(a, b) { return a.price - b.price; });
  if (currentSort === 'price-desc') filtered.sort(function(a, b) { return b.price - a.price; });
  return filtered;
}

function filterCategory(c) {
  currentCategory = c; currentPage = 1;
  document.querySelectorAll('.cat-btn').forEach(function(b) { b.classList.toggle('active', b.dataset.cat === c); });
  renderProducts(getFilteredProducts());
}

function sortProducts() {
  currentSort = document.getElementById('sortSelect').value; currentPage = 1;
  renderProducts(getFilteredProducts());
}

function goToPage(page) {
  var filtered = getFilteredProducts();
  var totalPages = Math.ceil(filtered.length / PRODUCTS_PER_PAGE);
  if (page < 1 || page > totalPages) return;
  currentPage = page;
  renderProducts(filtered);
  document.getElementById('products').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderProducts(items) {
  var grid = document.getElementById('productGrid');
  var noResults = document.getElementById('noResults');
  var countEl = document.getElementById('productCount');
  if (!items.length) { grid.innerHTML = ''; noResults.classList.remove('hidden'); countEl.textContent = '0'; document.getElementById('paginationControls').innerHTML = ''; return; }
  noResults.classList.add('hidden');
  var totalPages = Math.ceil(items.length / PRODUCTS_PER_PAGE);
  if (currentPage > totalPages) currentPage = totalPages;
  var startIndex = (currentPage - 1) * PRODUCTS_PER_PAGE;
  var endIndex = startIndex + PRODUCTS_PER_PAGE;
  var pageItems = items.slice(startIndex, endIndex);
  countEl.textContent = 'Showing ' + (startIndex + 1) + '–' + Math.min(endIndex, items.length) + ' of ' + items.length;

  grid.innerHTML = pageItems.map(function(p) {
    var priceUSD = (p.price / exchangeRate).toLocaleString('en-US', { minimumFractionDigits: 2 });
    var stockBadge = p.stock <= 0 ? '<span class="ml-2 px-2 py-0.5 bg-red-100 text-red-600 text-[10px] font-medium uppercase rounded-md">Out of Stock</span>' : p.stock < 10 ? '<span class="ml-2 px-2 py-0.5 bg-orange-100 text-orange-600 text-[10px] font-medium uppercase rounded-md">Low Stock</span>' : '<span class="ml-2 px-2 py-0.5 bg-green-100 text-green-600 text-[10px] font-medium uppercase rounded-md">In Stock</span>';
    var disabledAttr = p.stock <= 0 ? 'disabled' : '';
    var btnClass = p.stock <= 0 ? 'bg-gray-400 cursor-not-allowed opacity-50' : 'bg-txt-main hover:bg-brand';
    var btnText = p.stock <= 0 ? 'Out of Stock' : 'Add to Cart';
    return '<div class="product-card bg-white overflow-hidden"><div class="relative h-48 overflow-hidden cursor-pointer rounded-t-md" onclick="openModal(\'' + p.id + '\')"><img src="' + p.img + '" class="product-img w-full h-full object-cover transition-transform duration-500"><div class="absolute top-3 left-3"><span class="px-2.5 py-1 bg-white border border-txt-main text-[10px] font-medium uppercase tracking-wider rounded-md">' + p.catLabel + '</span></div><div class="absolute top-3 right-3"><span class="px-2 py-0.5 bg-txt-main text-white text-[9px] font-mono font-bold rounded-md">#' + p.id + '</span></div></div><div class="p-5 border-t border-txt-main"><div class="flex items-center justify-between mb-1"><h3 class="text-base font-semibold cursor-pointer hover:text-brand uppercase tracking-wider text-sm font-serif" onclick="openModal(\'' + p.id + '\')">' + p.name + '</h3>' + stockBadge + '</div><div class="flex items-center justify-between mt-2"><div><span class="text-xl font-semibold text-brand">NPR ' + p.price.toLocaleString() + ' <span class="text-xs font-normal lowercase text-txt-sub">/ ' + p.unit + '</span></span><span class="text-xs text-txt-sub block">$' + priceUSD + '</span></div><button onclick="addToCart(\'' + p.id + '\')" ' + disabledAttr + ' class="px-4 py-2 ' + btnClass + ' text-bg-light text-xs uppercase tracking-wider transition-all border border-txt-main shadow-md rounded-md">' + btnText + '</button></div></div></div>'; // Updated borders and text-brand for price
  }).join('');

  renderPagination(totalPages, items.length);
  lucide.createIcons();
}

function renderPagination(totalPages) {
  var container = document.getElementById('paginationControls');
  if (totalPages <= 1) { container.innerHTML = ''; return; }
  var pagesHtml = '<button onclick="goToPage(' + (currentPage - 1) + ')" ' + (currentPage === 1 ? 'disabled' : '') + ' class="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border border-txt-main ' + (currentPage === 1 ? 'opacity-40 cursor-not-allowed' : 'hover:bg-txt-main hover:text-bg-light') + ' transition-all uppercase text-xs rounded-md"><i data-lucide="chevron-left" class="w-4 h-4"></i>Prev</button>'; // Updated border
  var pageNumbers = [];
  if (totalPages <= 7) { for (var i = 1; i <= totalPages; i++) pageNumbers.push(i); } else {
    pageNumbers.push(1); if (currentPage > 3) pageNumbers.push('...');
    for (var j = Math.max(2, currentPage - 1); j <= Math.min(totalPages - 1, currentPage + 1); j++) pageNumbers.push(j);
    if (currentPage < totalPages - 2) pageNumbers.push('...'); pageNumbers.push(totalPages);
  }
  pageNumbers.forEach(function(p) {
    if (p === '...') pagesHtml += '<span class="px-2 py-2.5 text-sm text-txt-third">…</span>';
    else { var isActive = p === currentPage; pagesHtml += '<button onclick="goToPage(' + p + ')" class="w-10 h-10 flex items-center justify-center text-sm font-medium border border-txt-main transition-all rounded-md ' + (isActive ? 'bg-txt-main text-bg-light shadow-md' : 'hover:bg-brand hover:text-white') + '">' + p + '</button>'; } // Updated border
  });
  pagesHtml += '<button onclick="goToPage(' + (currentPage + 1) + ')" ' + (currentPage === totalPages ? 'disabled' : '') + ' class="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border border-txt-main ' + (currentPage === totalPages ? 'opacity-40 cursor-not-allowed' : 'hover:bg-txt-main hover:text-bg-light') + ' transition-all uppercase text-xs rounded-md">Next<i data-lucide="chevron-right" class="w-4 h-4"></i></button>'; // Updated border
  container.innerHTML = '<div class="flex flex-col sm:flex-row items-center justify-between gap-4 mt-8 pt-6 border-t border-txt-main"><p class="text-sm text-txt-third uppercase text-xs tracking-wider">Page <span class="font-semibold text-txt-main">' + currentPage + '</span> of <span class="font-semibold text-txt-main">' + totalPages + '</span></p><div class="flex items-center gap-2 flex-wrap justify-center">' + pagesHtml + '</div></div>'; // Updated border
  lucide.createIcons();
}

// ==========================================
// 10. SEARCH
// ==========================================
function initSearch() {
  document.getElementById('searchInput').addEventListener('input', function(e) {
    var query = e.target.value.toLowerCase().trim();
    var resultsDiv = document.getElementById('searchResults');
    if (!query) { resultsDiv.innerHTML = ''; return; }
    var matches = products.filter(function(p) { return p.name.toLowerCase().includes(query) || (p.sci && p.sci.toLowerCase().includes(query)) || p.category.toLowerCase().includes(query) || (p.catLabel && p.catLabel.toLowerCase().includes(query)); });
    if (!matches.length) { resultsDiv.innerHTML = '<p class="text-sm text-txt-third py-4 text-center uppercase tracking-wider">No products found.</p>'; return; }
    resultsDiv.innerHTML = matches.map(function(p) {
      return '<div class="flex items-center gap-3 p-3 hover:bg-bg-light cursor-pointer transition-colors border-b border-txt-main/20 rounded-md" onclick="closeSearch(); openModal(\'' + p.id + '\');"><img src="' + p.img + '" class="w-10 h-10 object-cover border border-txt-main rounded-md" onerror="this.style.display=\'none\'"><div class="flex-1 min-w-0"><p class="text-sm font-medium truncate uppercase text-xs">' + p.name + '</p><p class="text-[10px] text-txt-third uppercase">' + p.catLabel + ' · NPR ' + p.price.toLocaleString() + '</p></div><i data-lucide="arrow-up-right" class="w-4 h-4 text-txt-third flex-shrink-0"></i></div>'; // Updated border
    }).join('');
    lucide.createIcons();
  });
  document.getElementById('searchClose').addEventListener('click', closeSearch);
}
function openSearch() { document.getElementById('searchBar').style.display = 'block'; setTimeout(function() { document.getElementById('searchInput').focus(); }, 50); }
function closeSearch() { document.getElementById('searchBar').style.display = 'none'; document.getElementById('searchInput').value = ''; document.getElementById('searchResults').innerHTML = ''; }

// ==========================================
// 11. CART LOGIC
// ==========================================
function addToCart(id, qty) {
  qty = qty || 1;
  var p = products.find(function(x) { return String(x.id) === String(id); });
  if (!p) return;
  var existing = cart.find(function(i) { return String(i.id) === String(id) && i.unit === p.unit && i.form === 'Whole Form'; });
  if (existing) existing.qty += qty; else cart.push({ id: p.id, name: p.name, price: p.price, qty: qty, img: p.img, unit: p.unit, form: 'Whole Form' });
  updateCartUI(); showToast(p.name + ' added to cart'); syncCartToDB();
}
function updateCartUI() {
  var totalItems = cart.reduce(function(s, i) { return s + i.qty; }, 0);
  var countEl = document.getElementById('cartCount');
  if (totalItems > 0) { countEl.style.display = 'flex'; countEl.textContent = totalItems; } else { countEl.style.display = 'none'; }
  var cartDiv = document.getElementById('cartItems');
  if (cartDiv) cartDiv.innerHTML = cart.map(function(i) { return '<div class="flex gap-4 py-4 border-b border-txt-main/20"><img src="' + i.img + '" class="w-16 h-16 object-cover border border-txt-main rounded-md"><div><h4 class="font-medium uppercase text-sm font-serif">' + i.name + '</h4><p class="text-xs text-txt-sub uppercase">' + i.form + ' · ' + i.unit + '</p><p class="text-sm">' + i.qty + ' x NPR ' + i.price.toLocaleString() + '</p><button onclick="removeFromCart(\'' + i.id + '\',\'' + i.unit + '\',\'' + i.form + '\')" class="text-red-500 text-xs mt-1 uppercase font-bold">Remove</button></div></div>'; }).join(''); // Updated borders
  var totalNPR = cart.reduce(function(s, i) { return s + i.price * i.qty; }, 0);
  document.getElementById('cartTotal').innerHTML = 'NPR ' + totalNPR.toLocaleString();
  document.getElementById('cartTotalUsd').innerHTML = '$' + (totalNPR / exchangeRate).toLocaleString('en-US', { minimumFractionDigits: 2 });
  var footer = document.getElementById('cartFooter');
  if (cart.length) footer.classList.remove('hidden'); else footer.classList.add('hidden');
  document.getElementById('cartItemCount').textContent = '(' + totalItems + ' items)';
}
function removeFromCart(id, unit, form) { cart = cart.filter(function(i) { return !(String(i.id) === String(id) && i.unit === unit && i.form === form); }); updateCartUI(); showToast('Removed'); syncCartToDB(); }
function clearCart() { cart = []; updateCartUI(); showToast('Cart cleared'); syncCartToDB(); }
function openCart() { document.getElementById('cartOverlay').classList.remove('hidden'); setTimeout(function() { document.getElementById('cartPanel').style.transform = 'translateX(0)'; }, 10); }
function closeCart() { document.getElementById('cartPanel').style.transform = 'translateX(100%)'; setTimeout(function() { document.getElementById('cartOverlay').classList.add('hidden'); }, 300); }
function proceedToInquiry() {
  if (!cart.length) return; closeCart();
  var msg = document.getElementById('contactMessage'); var total = cart.reduce(function(s, i) { return s + i.price * i.qty; }, 0);
  msg.value += '\n\n--- Cart Total: NPR ' + total.toLocaleString() + ' ---\n';
  cart.forEach(function(i) { msg.value += '- ' + i.name + ' (' + i.form + ', ' + i.unit + '): ' + i.qty + ' x NPR ' + i.price + '\n'; });
  document.getElementById('contact').scrollIntoView({ behavior: 'smooth' }); showToast('Cart added to inquiry');
}

// ==========================================
// 12. PRODUCT MODAL
// ==========================================
function openModal(id) {
  var p = products.find(function(x) { return String(x.id) === String(id); }); if (!p) return; currentModalProduct = p;
  var formOptions = [], unitOptions = [];
  switch (p.category) { case 'oils': formOptions = ['Liquid Form']; unitOptions = ['15ml','30ml','50ml','100ml','200ml','500ml','1000ml']; break; case 'extracts': case 'mushrooms': case 'rasa': formOptions = ['Whole Form']; unitOptions = ['10gm','125gm','250gm','500gm','1kg']; break; case 'herbs': case 'namak': case 'seeds / masala': formOptions = ['Whole Form', 'Powder Form']; unitOptions = ['10gm','125gm','250gm','500gm','1kg']; break; case 'herbal soap': formOptions = ['Whole Bar']; unitOptions = ['100gm']; break; default: formOptions = ['Whole Form']; unitOptions = ['1kg']; break; }
  selectedForm = formOptions[0]; selectedUnitValue = unitOptions[unitOptions.length - 1];
  var iconMap = { 'Liquid Form': 'droplet', 'Powder Form': 'cloud', 'Whole Bar': 'droplets', 'Whole Form': 'leaf' };
  var html = '<div class="relative"><img src="' + p.img + '" class="w-full h-44 object-cover rounded-t-xl" onerror="this.style.display=\'none\'"><button onclick="closeModal()" class="absolute top-2 right-2 w-7 h-7 bg-white border border-txt-main flex items-center justify-center shadow-md rounded-full"><i data-lucide="x" class="w-3.5 h-3.5"></i></button><div class="absolute top-2 left-2 px-2 py-0.5 bg-brand text-white text-[9px] font-medium uppercase tracking-wider border border-txt-main rounded-md">' + p.catLabel + '</div><div class="absolute bottom-2 right-2 px-2 py-0.5 bg-txt-main text-white text-[8px] font-mono font-bold rounded-md">#' + p.id + '</div></div><div class="p-4"><div class="flex justify-between items-start gap-2 mb-1"><h3 class="text-lg font-semibold tracking-tight uppercase font-serif">' + p.name + '</h3><span class="text-[10px] font-mono bg-brand/10 px-2 py-0.5 border border-txt-main text-brand font-bold rounded-md">#' + p.id + '</span></div><p class="text-[10px] text-txt-third italic mb-2">' + (p.sci || '') + '</p><p class="text-[11px] text-txt-sub leading-relaxed mb-3 line-clamp-2">' + (p.desc || '') + '</p><div class="grid grid-cols-2 gap-2 mb-3"><div class="fancy-select relative" id="formDDCont"><div class="flex items-center justify-between p-2 border border-txt-main bg-white cursor-pointer text-xs rounded-md" onclick="toggleDropdown(\'form\')"><div class="flex items-center gap-1.5"><i data-lucide="' + (iconMap[selectedForm] || 'layers') + '" class="w-3 h-3 text-brand"></i><span class="text-[11px] font-medium uppercase" id="selFormLabel">' + selectedForm + '</span></div><i data-lucide="chevron-down" class="w-3 h-3 transition-transform" id="formChev"></i></div><div class="fancy-select-dropdown" id="formDD">' + formOptions.map(function(opt) { return '<div class="fancy-option text-xs py-1.5 px-3" onclick="selectForm(\'' + opt + '\')"><i data-lucide="' + (iconMap[opt] || 'layers') + '" class="w-3 h-3"></i><span class="uppercase">' + opt + '</span></div>'; }).join('') + '</div></div><div class="fancy-select relative" id="unitDDCont"><div class="flex items-center justify-between p-2 border border-txt-main bg-white cursor-pointer text-xs rounded-md" onclick="toggleDropdown(\'unit\')"><div class="flex items-center gap-1.5"><i data-lucide="scale" class="w-3 h-3 text-brand"></i><span class="text-[11px] font-medium uppercase" id="selUnitLabel">' + selectedUnitValue + '</span></div><i data-lucide="chevron-down" class="w-3 h-3 transition-transform" id="unitChev"></i></div><div class="fancy-select-dropdown" id="unitDD">' + unitOptions.map(function(opt) { return '<div class="fancy-option text-xs py-1.5 px-3" onclick="selectUnit(\'' + opt + '\')"><i data-lucide="' + (opt.includes('ml') ? 'droplet' : 'cube') + '" class="w-3 h-3"></i><span>' + opt + '</span></div>'; }).join('') + '</div></div></div><div class="bg-brand/5 p-2.5 border border-txt-main mb-3 rounded-lg"><div class="flex justify-between items-center"><div><span class="text-[9px] uppercase text-txt-sub font-bold">Total Price</span><div class="text-lg font-bold text-brand" id="dynPrice">NPR 0</div><div class="text-[9px] text-txt-sub" id="dynUsd">$0.00</div><div id="powderNote" class="text-[8px] text-orange-500 mt-1 font-bold uppercase ' + (selectedForm === 'Powder Form' ? '' : 'hidden') + '">+NPR 50/kg powder fee included</div></div><div class="text-right"><span class="text-[8px] bg-brand/10 px-1.5 py-0.5 border border-txt-main uppercase font-bold rounded-sm" id="mFormBadge">' + selectedForm + '</span><span class="text-[8px] bg-brand/10 px-1.5 py-0.5 border border-txt-main ml-1 uppercase font-bold rounded-sm" id="mUnitBadge">' + selectedUnitValue + '</span></div></div></div><div class="grid grid-cols-3 gap-1.5 mb-3"><div class="p-1.5 bg-bg-dark2 text-center border border-txt-main rounded-md"><p class="text-[8px] text-white/50 mb-0.5 uppercase">Base Unit</p><p class="text-[10px] text-bg-light font-medium">' + (p.unit || '1 kg') + '</p></div><div class="p-1.5 bg-bg-dark2 text-center border border-txt-main rounded-md"><p class="text-[8px] text-white/50 mb-0.5 uppercase">MOQ</p><p class="text-[10px] text-bg-light font-medium">' + (p.moq || '1 kg') + '</p></div><div class="p-1.5 bg-bg-dark2 text-center border border-txt-main rounded-md"><p class="text-[8px] text-white/50 mb-0.5 uppercase">Lead</p><p class="text-[10px] text-bg-light font-medium">' + (p.lead || '7d') + '</p></div></div><div class="flex gap-2"><div class="flex items-center border border-txt-main overflow-hidden rounded-md"><button onclick="changeQty(-1)" class="px-2.5 py-1.5 hover:bg-txt-main hover:text-bg-light"><i data-lucide="minus" class="w-3 h-3"></i></button><input id="modalQty" type="number" value="1" min="1" class="w-10 text-center py-1.5 text-xs font-medium border-x border-txt-main focus:outline-none"><button onclick="changeQty(1)" class="px-2.5 py-1.5 hover:bg-txt-main hover:text-bg-light"><i data-lucide="plus" class="w-3 h-3"></i></button></div><button onclick="addEnhancedToCart()" class="flex-1 py-1.5 bg-brand text-white text-xs font-medium hover:bg-brand-hover flex items-center justify-center gap-1.5 transition-all uppercase border border-txt-main shadow-brand rounded-md"><i data-lucide="shopping-bag" class="w-3.5 h-3.5"></i> Add to Cart</button></div></div>'; // Updated border-2 to border and border-x-2 to border-x
  document.getElementById('modalDynamicContent').innerHTML = html;
  document.getElementById('productModal').classList.remove('hidden'); document.getElementById('productModal').classList.add('flex');
  setTimeout(function() { lucide.createIcons(); updateModalPrice(); }, 50);
}
function closeModal() { document.getElementById('productModal').classList.add('hidden'); document.getElementById('productModal').classList.remove('flex'); currentModalProduct = null; }
function toggleDropdown(type) { var container = document.getElementById(type + 'DDCont'); var chev = document.getElementById(type + 'Chev'); if (!container) return; var otherType = type === 'form' ? 'unit' : 'form'; var otherCont = document.getElementById(otherType + 'DDCont'); var otherChev = document.getElementById(otherType + 'Chev'); if (otherCont) otherCont.classList.remove('open'); if (otherChev) otherChev.classList.remove('rotate-180'); container.classList.toggle('open'); chev.classList.toggle('rotate-180'); }
function selectForm(form) { selectedForm = form; document.getElementById('selFormLabel').innerText = form; document.getElementById('mFormBadge').innerText = form; var pn = document.getElementById('powderNote'); if (pn) pn.classList.toggle('hidden', form !== 'Powder Form'); document.getElementById('formDDCont').classList.remove('open'); document.getElementById('formChev').classList.remove('rotate-180'); updateModalPrice(); }
function selectUnit(unit) { selectedUnitValue = unit; document.getElementById('selUnitLabel').innerText = unit; document.getElementById('mUnitBadge').innerText = unit; document.getElementById('unitDDCont').classList.remove('open'); document.getElementById('unitChev').classList.remove('rotate-180'); updateModalPrice(); }
function updateModalPrice() { if (!currentModalProduct) return; var qty = parseInt(document.getElementById('modalQty').value) || 1; var finalPriceNPR = calculateModalPrice(currentModalProduct, selectedForm, selectedUnitValue, qty); document.getElementById('dynPrice').innerHTML = 'NPR ' + finalPriceNPR.toLocaleString(); document.getElementById('dynUsd').innerHTML = '$' + (finalPriceNPR / exchangeRate).toFixed(2); }
function changeQty(delta) { var inp = document.getElementById('modalQty'); if (inp) inp.value = Math.max(1, (parseInt(inp.value) || 1) + delta); updateModalPrice(); }
function addEnhancedToCart() { if (!currentModalProduct) return; var qty = parseInt(document.getElementById('modalQty').value) || 1; var unitPriceNPR = calculateModalPrice(currentModalProduct, selectedForm, selectedUnitValue, 1); var cartItem = { id: currentModalProduct.id, name: currentModalProduct.name, img: currentModalProduct.img, unit: selectedUnitValue, form: selectedForm, price: unitPriceNPR, qty: qty }; var existing = cart.find(function(i) { return String(i.id) === String(cartItem.id) && i.unit === cartItem.unit && i.form === cartItem.form; }); if (existing) existing.qty += qty; else cart.push(cartItem); updateCartUI(); showToast('Added ' + qty + ' x ' + selectedUnitValue + ' ' + selectedForm); closeModal(); syncCartToDB(); }

// ==========================================
// 13. PAYMENT MODAL & ORDER
// ==========================================
function openPaymentModal(method) { selectedPaymentMethod = method; var totalNPR = cart.reduce(function(s, i) { return s + i.price * i.qty; }, 0); var totalUSD = totalNPR / exchangeRate; document.getElementById('paymentTotal').innerHTML = 'NPR ' + totalNPR.toLocaleString(); document.getElementById('paymentTotalSub').innerHTML = '$' + totalUSD.toFixed(2); document.getElementById('paymentItemsCount').innerHTML = cart.reduce(function(s, i) { return s + i.qty; }, 0) + ' items'; document.querySelectorAll('.pay-tab').forEach(function(t) { t.classList.remove('active'); }); document.getElementById('tab-' + method).classList.add('active'); document.getElementById('paymentMethodLabel').innerHTML = method === 'esewa' ? 'eSewa' : 'Khalti'; document.getElementById('qr-esewa').classList.toggle('hidden', method !== 'esewa'); document.getElementById('qr-khalti').classList.toggle('hidden', method !== 'khalti'); document.getElementById('paymentModal').classList.remove('hidden'); document.getElementById('paymentModal').classList.add('flex'); document.body.classList.add('payment-modal-open'); }
function closePaymentModal() { document.getElementById('paymentModal').classList.add('hidden'); document.getElementById('paymentModal').classList.remove('flex'); document.body.classList.remove('payment-modal-open'); }
function switchPaymentTab(method) { openPaymentModal(method); }
function setPaymentCurrency(curr) { selectedPaymentCurrency = curr; var totalNPR = cart.reduce(function(s, i) { return s + i.price * i.qty; }, 0); var totalUsd = totalNPR / exchangeRate; if (curr === 'npr') { document.getElementById('paymentTotal').innerHTML = 'NPR ' + totalNPR.toLocaleString(); document.getElementById('paymentTotalSub').innerHTML = '$' + totalUsd.toFixed(2); } else { document.getElementById('paymentTotal').innerHTML = '$' + totalUsd.toFixed(2); document.getElementById('paymentTotalSub').innerHTML = 'NPR ' + totalNPR.toLocaleString(); } document.querySelectorAll('.currency-btn').forEach(function(b) { b.classList.remove('active-curr'); }); document.getElementById(curr === 'npr' ? 'btnNPR' : 'btnUSD').classList.add('active-curr'); }
function handleFileUpload(e) { var f = e.target.files[0]; if (!f) return; if (f.size > 5 * 1024 * 1024) { showToast('Max 5MB', 'error'); return; } rawFileForUpload = f; lastCompressedBase64 = null; document.getElementById('uploadPlaceholder').classList.add('hidden'); document.getElementById('uploadProgressContainer').classList.remove('hidden'); var reader = new FileReader(); reader.onload = function(ev) { document.getElementById('progressBar').style.width = '100%'; setTimeout(function() { document.getElementById('uploadProgressContainer').classList.add('hidden'); document.getElementById('imagePreviewContainer').classList.remove('hidden'); document.getElementById('imagePreview').src = ev.target.result; lucide.createIcons(); }, 300); }; reader.readAsDataURL(f); }
function clearScreenshot(e) { if (e) e.stopPropagation(); rawFileForUpload = null; lastCompressedBase64 = null; document.getElementById('paymentScreenshot').value = ""; document.getElementById('uploadPlaceholder').classList.remove('hidden'); document.getElementById('uploadProgressContainer').classList.add('hidden'); document.getElementById('imagePreviewContainer').classList.add('hidden'); document.getElementById('progressBar').style.width = '0%'; }

async function submitOrderToBackend() {
  var name = document.getElementById('clientName').value.trim(); var phone = document.getElementById('clientPhone').value.trim(); var email = document.getElementById('clientEmail').value.trim(); var address = document.getElementById('clientAddress').value.trim();
  if (!name) { showToast('Please enter your full name', 'error'); document.getElementById('clientName').classList.add('input-error'); return; }
  if (!phone) { showToast('Please enter your phone number', 'error'); document.getElementById('clientPhone').classList.add('input-error'); return; }
  if (!email || !email.includes('@') || !email.includes('.')) { showToast('Please enter a valid email', 'error'); document.getElementById('clientEmail').classList.add('input-error'); return; }
  if (!rawFileForUpload && !lastCompressedBase64) { showToast('Please upload payment screenshot', 'error'); return; }
  if (!cart.length) { showToast('Cart is empty', 'error'); return; }
  ['clientName', 'clientPhone', 'clientEmail'].forEach(function(id) { document.getElementById(id).classList.remove('input-error'); });
  showProcessingOverlay(1);
  var compressedBase64 = lastCompressedBase64;
  try { if (!compressedBase64 && rawFileForUpload) { compressedBase64 = await compressImage(rawFileForUpload); lastCompressedBase64 = compressedBase64; } } catch (e) { hideProcessingOverlay(); showErrorPopup('Failed to process image.'); return; }
  showProcessingOverlay(2);
  try {
    var totalNPR = cart.reduce(function(s, i) { return s + i.price * i.qty; }, 0); var totalUSD = totalNPR / exchangeRate; var paidAmount = selectedPaymentCurrency === 'npr' ? totalNPR : totalUSD; var currency = selectedPaymentCurrency === 'npr' ? 'NPR' : 'USD';
    var orderData = { items: cart.map(function(i) { return { id: i.id, name: i.name, price: i.price, qty: i.qty, unit: i.unit, form: i.form }; }), totalNPR: totalNPR, totalUSD: totalUSD, paidAmount: paidAmount, currency: currency, paymentMethod: selectedPaymentMethod, paymentScreenshot: compressedBase64, clientDetails: { name: name, phone: phone, email: email, address: address || 'N/A' } };
    var res = await fetchWithTimeout(BACKEND_URL + '/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(orderData) }, 20000);
    showProcessingOverlay(3);
    if (res.ok) { var data = await res.json(); hideProcessingOverlay(); showSuccessPopup(data.orderId || data._id || 'PENDING'); cart = []; updateCartUI(); rawFileForUpload = null; lastCompressedBase64 = null; clearScreenshot(); ['clientName', 'clientPhone', 'clientEmail', 'clientAddress'].forEach(function(id) { document.getElementById(id).value = ""; }); closePaymentModal(); syncCartToDB(); }
    else { var err = await res.json(); hideProcessingOverlay(); showErrorPopup(err.message || 'Server rejected the order.'); }
  } catch (err) { hideProcessingOverlay(); showErrorPopup('Network error. Please check your connection and retry.'); }
}
function retrySubmission() { closeErrorPopup(); submitOrderToBackend(); }

// ==========================================
// 14. INQUIRY FORM
// ==========================================
async function submitInquiry(e) {
  e.preventDefault(); var btn = e.target.querySelector('button[type="submit"]'); var msgDiv = document.getElementById('formMsg'); btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Sending...'; lucide.createIcons();
  try {
    var res = await fetchWithTimeout(BACKEND_URL + '/inquiries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ firstName: document.getElementById('inquiryFirstName').value, lastName: document.getElementById('inquiryLastName').value, email: document.getElementById('inquiryEmail').value, company: document.getElementById('inquiryCompany').value || '', message: document.getElementById('contactMessage').value }) });
    if (res.ok) { msgDiv.textContent = '✓ Thank you! Inquiry sent.'; msgDiv.classList.remove('hidden', 'text-red-500'); msgDiv.classList.add('text-brand'); e.target.reset(); showToast('Inquiry sent successfully!'); } else throw new Error();
  } catch (err) { msgDiv.textContent = '✕ Error sending inquiry.'; msgDiv.classList.remove('hidden', 'text-brand'); msgDiv.classList.add('text-red-500'); showToast('Failed to send inquiry', 'error'); }
  finally { btn.disabled = false; btn.innerHTML = 'Send Inquiry <i data-lucide="send" class="w-4 h-4"></i>'; lucide.createIcons(); }
}

// ==========================================
// 15. AUTHENTICATION
// ==========================================
async function checkAuthState() {
  var loggedOutDiv = document.getElementById('authButtonsLoggedOut'); var loggedInDiv = document.getElementById('authButtonsLoggedIn'); var userNameSpan = document.getElementById('userNameDisplay');
  if (authToken) { try { var res = await fetchWithTimeout(BACKEND_URL + '/auth/me', { headers: { 'Authorization': 'Bearer ' + authToken } }); if (res.ok) { currentUser = await res.json(); loggedInDiv.style.display = 'flex'; loggedOutDiv.style.display = 'none'; userNameSpan.innerText = currentUser.name || currentUser.email; if (currentUser.isVerified && currentUser.cart && currentUser.cart.length > 0) { if (cart.length === 0) { cart = currentUser.cart; updateCartUI(); } else { syncCartToDB(true); } } lucide.createIcons(); return; } } catch (e) { console.error('Auth check failed:', e.message); } }
  currentUser = null; authToken = null; localStorage.removeItem('natura_token'); loggedInDiv.style.display = 'none'; loggedOutDiv.style.display = ''; lucide.createIcons();
}
function openAuthModal(type) { document.getElementById(type + 'Modal').classList.remove('hidden'); document.getElementById(type + 'Modal').classList.add('flex'); }
function closeAuthModal(type) { document.getElementById(type + 'Modal').classList.add('hidden'); document.getElementById(type + 'Modal').classList.remove('flex'); }
function switchAuthModal(type) { ['signin', 'signup', 'otp', 'forgot'].forEach(function(t) { closeAuthModal(t); }); openAuthModal(type); }

async function handleSignup(e) { e.preventDefault(); var btn = e.target.querySelector('button'); btn.disabled = true; btn.innerText = 'Creating...'; try { var res = await fetchWithTimeout(BACKEND_URL + '/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: document.getElementById('signupName').value, email: document.getElementById('signupEmail').value, password: document.getElementById('signupPassword').value }) }); var data = await res.json(); if (res.ok) { showToast('Account created! Check email for 6-digit code.'); document.getElementById('otpEmailDisplay').innerText = document.getElementById('signupEmail').value; switchAuthModal('otp'); } else { showToast(data.error || 'Signup failed', 'error'); } } catch (e) { showToast('Network error', 'error'); } btn.disabled = false; btn.innerText = 'Create Account'; }
async function handleSignin(e) { e.preventDefault(); var btn = e.target.querySelector('button'); btn.disabled = true; btn.innerText = 'Signing in...'; try { var res = await fetchWithTimeout(BACKEND_URL + '/auth/signin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: document.getElementById('signinEmail').value, password: document.getElementById('signinPassword').value }) }); var data = await res.json(); if (res.ok) { authToken = data.token; localStorage.setItem('natura_token', authToken); currentUser = data.user; closeAuthModal('signin'); if (!data.user.isVerified) { document.getElementById('otpEmailDisplay').innerText = data.user.email; openAuthModal('otp'); } else { checkAuthState(); showToast('Welcome back, ' + data.user.name + '!'); } } else { showToast(data.error || 'Invalid email or password', 'error'); } } catch (e) { showToast('Network error', 'error'); } btn.disabled = false; btn.innerText = 'Sign In'; }
async function handleVerifyOTP(e) { e.preventDefault(); try { var res = await fetchWithTimeout(BACKEND_URL + '/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: document.getElementById('otpEmailDisplay').innerText, code: document.getElementById('otpCode').value }) }); var data = await res.json(); if (res.ok) { authToken = data.token; localStorage.setItem('natura_token', authToken); closeAuthModal('otp'); checkAuthState(); showToast('Email verified successfully!'); } else { showToast(data.error || 'Invalid or expired code', 'error'); } } catch (e) { showToast('Network error', 'error'); } }
async function handleResendOTP() { var email = document.getElementById('otpEmailDisplay').innerText; if (!email) return; try { var res = await fetchWithTimeout(BACKEND_URL + '/auth/resend-otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email }) }); var data = await res.json(); showToast(res.ok ? 'New 6-digit code sent!' : data.error, res.ok ? 'success' : 'error'); } catch (e) { showToast('Error', 'error'); } }
async function handleForgotPassword(e) { e.preventDefault(); var btn = e.target.querySelector('button'); var email = document.getElementById('forgotEmail').value.trim(); if (!email) { showToast('Enter your email', 'error'); return; } btn.disabled = true; btn.innerText = 'Sending...'; try { var res = await fetchWithTimeout(BACKEND_URL + '/auth/forgot-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email }) }); var data = await res.json(); if (res.ok) { document.getElementById('forgotStep1').classList.add('hidden'); document.getElementById('forgotStep2').classList.remove('hidden'); showToast('Reset code sent!'); } else { showToast(data.error || 'Failed to send code', 'error'); } } catch (e) { showToast('Network error', 'error'); } btn.disabled = false; btn.innerText = 'Send Reset Code'; }
async function handleResetPassword(e) { e.preventDefault(); var btn = e.target.querySelector('button'); var email = document.getElementById('forgotEmail').value.trim(); var otp = document.getElementById('resetOtp').value.trim(); var newPass = document.getElementById('resetNewPassword').value; if (!otp || otp.length !== 6) { showToast('Enter the 6-digit code', 'error'); return; } if (!newPass || newPass.length < 8) { showToast('Password must be 8-30 characters', 'error'); return; } btn.disabled = true; btn.innerText = 'Resetting...'; try { var res = await fetchWithTimeout(BACKEND_URL + '/auth/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email, otp: otp, newPassword: newPass }) }); var data = await res.json(); if (res.ok) { showToast('Password reset! Please sign in.'); switchAuthModal('signin'); document.getElementById('forgotStep1').classList.remove('hidden'); document.getElementById('forgotStep2').classList.add('hidden'); document.getElementById('forgotEmail').value = ''; document.getElementById('resetOtp').value = ''; document.getElementById('resetNewPassword').value = ''; } else { showToast(data.error || 'Reset failed', 'error'); } } catch (e) { showToast('Network error', 'error'); } btn.disabled = false; btn.innerText = 'Reset Password'; }
function handleLogout() { authToken = null; currentUser = null; localStorage.removeItem('natura_token'); cart = []; updateCartUI(); checkAuthState(); showToast('Signed out'); }
async function syncCartToDB(returnUpdatedCart) { if (!authToken || !currentUser || !currentUser.isVerified) return; try { var res = await fetchWithTimeout(BACKEND_URL + '/auth/cart/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken }, body: JSON.stringify({ cart: cart }) }, 5000); if (returnUpdatedCart && res.ok) { var data = await res.json(); if (data.cart) { cart = data.cart; updateCartUI(); } } } catch (e) { console.error('Cart sync failed:', e.message); } }

// ==========================================
// 16. MOBILE MENU
// ==========================================
function closeMobile() { document.getElementById('mobilePanel').style.transform = 'translateX(100%)'; setTimeout(function() { document.getElementById('mobileOverlay').classList.add('hidden'); }, 300); }

// ==========================================
// 17. AI CHAT WIDGET (WITH SOCKET.IO)
// ==========================================
var chatSessionId = 'sess_' + Math.random().toString(36).substr(2, 9);
var chatOpen = false;
var isLiveChat = false;
var socket = io();

socket.on('connect', function() { socket.emit('join-session', chatSessionId); });
socket.on('admin-msg', function(text) { appendMessage('bot', '👨‍💼 Admin: ' + text); });
socket.on('admin-image', function(base64) { var container = document.getElementById('chat-messages'); var div = document.createElement('div'); div.className = 'msg bot'; var adminLabel = document.createElement('div'); adminLabel.style.fontSize = '10px'; adminLabel.style.fontWeight = 'bold'; adminLabel.style.marginBottom = '4px'; adminLabel.innerText = '👨‍💼 Admin:'; var img = document.createElement('img'); img.src = base64; img.style.maxWidth = '100%'; img.style.borderRadius = '4px'; img.style.marginTop = '5px'; div.appendChild(adminLabel); div.appendChild(img); container.appendChild(div); container.scrollTop = container.scrollHeight; });

function toggleChat() { var box = document.getElementById('ai-chat-box'); var btn = document.getElementById('ai-chat-btn'); chatOpen = !chatOpen; if (chatOpen) { box.classList.add('open'); btn.style.display = 'none'; lucide.createIcons(); } else { box.classList.remove('open'); btn.style.display = 'flex'; } }
async function sendChat() {
  var input = document.getElementById('chat-input'); var msg = input.value.trim(); if (!msg) return; appendMessage('user', msg); input.value = '';
  if (isLiveChat) { socket.emit('client-message', { sessionId: chatSessionId, text: msg }); return; }
  try {
    var res = await fetchWithTimeout(BACKEND_URL + '/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: msg, sessionId: chatSessionId }) }, 10000);
    var data = await res.json(); appendMessage('bot', data.reply);
    if (data.handoff) { isLiveChat = true; appendMessage('bot', '⏳ You are now in Live Chat. An admin will respond shortly...'); document.getElementById('chat-input').placeholder = "Live chat active..."; document.getElementById('handoff-section').style.display = 'none'; socket.emit('client-message', { sessionId: chatSessionId, text: 'User requested a human agent.' }); }
  } catch (err) { appendMessage('bot', 'Network error. Please try again.'); }
}
function appendMessage(sender, text) { var container = document.getElementById('chat-messages'); var div = document.createElement('div'); div.className = 'msg ' + (sender === 'user' ? 'user' : 'bot'); div.textContent = text; container.appendChild(div); container.scrollTop = container.scrollHeight; }

// ==========================================
// 18. EVENT LISTENERS
// ==========================================
function initEventListeners() {
  document.getElementById('cartToggle').addEventListener('click', openCart);
  document.getElementById('searchToggle').addEventListener('click', openSearch);
  document.getElementById('mobileMenu').addEventListener('click', function() { document.getElementById('mobileOverlay').classList.remove('hidden'); setTimeout(function() { document.getElementById('mobilePanel').style.transform = 'translateX(0)'; }, 10); });
  document.getElementById('mobileClose').addEventListener('click', closeMobile);
  document.getElementById('cartOverlay').addEventListener('click', function(e) { if (e.target === e.currentTarget) closeCart(); });
  document.getElementById('productModal').addEventListener('click', function(e) { if (e.target === e.currentTarget) closeModal(); });
  document.getElementById('paymentModal').addEventListener('click', function(e) { if (e.target === e.currentTarget) closePaymentModal(); });
  document.addEventListener('keydown', function(e) { if (e.key === 'Escape') { closeModal(); closePaymentModal(); closeSearch(); ['signin', 'signup', 'otp', 'forgot'].forEach(function(t) { closeAuthModal(t); }); } });
  initSearch();
}

// ==========================================
// 19. BOOT
// ==========================================
lucide.createIcons();
initEventListeners();
loadExchangeRate();
loadTrending();
loadVisitorCount();
checkAuthState();
